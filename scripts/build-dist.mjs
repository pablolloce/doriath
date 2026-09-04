#!/usr/bin/env node
/**
 * Construye el payload de distribución en dist/KDD-Studio:
 *   app/          código + node_modules de producción (paquete Copilot de Windows x64)
 *   runtime/node/ Node.js portable para Windows
 *   data/ outputs/ knowledge-bases/  carpetas vacías (las crea también el instalador)
 *   kdd-root.json, KDD Studio.cmd, KDD Studio-Diagnostico.cmd, BUILD.json
 *
 * Opciones: --fresh (reinstala node_modules desde el registro en vez de copiar el árbol probado),
 *           --skip-node (no descarga Node), --platform linux (payload Linux para pruebas)
 */
import { cp, mkdir, rm, writeFile, readFile, copyFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { download } from "./launcher/download.cjs";
import { extractZip } from "./launcher/zip.cjs";

const require = createRequire(import.meta.url);
const tools = require("./launcher/tools.json");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// KDD_DIST permite construir en otra unidad con más espacio (p. ej. KDD_DIST=D:\\kdd-dist).
const dist = process.env.KDD_DIST ? path.resolve(process.env.KDD_DIST) : path.join(root, "dist");
// La edición decide el nombre, el proveedor de modelo y qué runtime viaja dentro.
const EDITIONS = {
  studio: { name: "KDD Studio", executable: "KDD-Studio", runtime: "copilot" },
  assistant: { name: "KDD Assistant", executable: "KDD-Assistant", runtime: "codex" },
};
const editionFlag = (() => { const a = process.argv.slice(2); const i = a.indexOf("--edition"); return i >= 0 ? String(a[i + 1] || "").toLowerCase() : ""; })();
const requested = editionFlag || String(process.env.KDD_EDITION || "").toLowerCase();
const editionId = EDITIONS[requested] ? requested : "studio";
const edition = EDITIONS[editionId];
const target = path.join(dist, edition.executable);
const cache = path.join(root, ".cache");
const args = process.argv.slice(2);
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const platform = flag("--platform") || "win32";
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function log(message) {
  process.stdout.write(`[build-dist] ${message}\n`);
}

async function stageApp() {
  const app = path.join(target, "app");
  await mkdir(app, { recursive: true });
  for (const item of ["src", "public", "prompts", "kdd-reference", "package.json", "package-lock.json", "README.md"]) {
    if (existsSync(path.join(root, item))) await cp(path.join(root, item), path.join(app, item), { recursive: true });
  }
  await mkdir(path.join(app, "docs"), { recursive: true });
  await cp(path.join(root, "docs", "identidad-bbva"), path.join(app, "docs", "identidad-bbva"), { recursive: true });
  await writeFile(path.join(app, "edition.json"), JSON.stringify({ edition: editionId, name: edition.name, builtAt: new Date().toISOString() }, null, 2));
  log(`Código de la aplicación copiado (edición ${editionId}).`);
  return app;
}

function copilotPlatformPackage() {
  return `@github/copilot-${platform}-x64`;
}

/**
 * Codex viaja dentro del instalador de KDD Assistant. El paquete `@openai/codex` es un lanzador de
 * 13 KB con dependencias opcionales por plataforma —la misma forma que `@github/copilot`—, así que
 * se instala el envoltorio y el binario de la plataforma destino a propósito, sin depender de que
 * npm acierte con la selección.
 */
async function installCodexRuntime(app, platformEnv) {
  const wrapper = "@openai/codex";
  const sdk = "@openai/codex-sdk";
  const binary = `@openai/codex-${platform}-x64`;
  const installed = path.join(app, "node_modules", "@openai", `codex-${platform}-x64`);
  const sdkInstalled = path.join(app, "node_modules", "@openai", "codex-sdk");
  if (existsSync(installed) && existsSync(sdkInstalled)) {
    log(`Runtime de Codex ya presente (${platform}-x64).`);
    return;
  }
  log(`Instalando el runtime de Codex para ${platform}-x64…`);
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "install-deps.mjs"), "--production", "--cwd", app, "--packages", `${wrapper},${sdk},${binary}`], { stdio: "inherit", env: platformEnv });
  if (result.status !== 0 || !existsSync(installed)) {
    throw new Error(`No se pudo instalar ${binary}. KDD Assistant no puede iniciar sesión con ChatGPT sin el binario de Codex dentro del instalador.`);
  }
  if (!existsSync(sdkInstalled)) throw new Error(`No se pudo instalar ${sdk}. Sin él KDD Assistant no puede hablar con el modelo.`);
  log("Runtime y SDK de Codex incluidos en el payload.");
}

/**
 * El runtime de Copilot ocupa unos 300 MB y KDD Assistant no lo usa: su motor es Codex. Se retira
 * del payload junto al SDK, que sin runtime no sirve para nada.
 */
async function pruneCopilotRuntime(app) {
  for (const name of [`@github/copilot-${platform}-x64`, "@github/copilot", "@github/copilot-sdk"]) {
    const dir = path.join(app, "node_modules", ...name.split("/"));
    if (!existsSync(dir)) continue;
    await rm(dir, { recursive: true, force: true });
    log(`Retirado ${name}: KDD Assistant no habla con Copilot.`);
  }
  await rm(path.join(app, "node_modules", ".bin", "copilot"), { force: true });
}

async function readInstalledVersion(dir, name) {
  try {
    return JSON.parse(await readFile(path.join(dir, "node_modules", ...name.split("/"), "package.json"), "utf8")).version;
  } catch {
    return "";
  }
}

/**
 * Dependencias del payload. Igual que build-dist.mjs de FENIX, por defecto se copia el árbol
 * `node_modules` ya probado del checkout (incluye el runtime Copilot de la plataforma del equipo
 * que construye); `--fresh`, o construir para otra plataforma, reinstala desde el registro con el
 * mismo reintento que `npm run setup`. En ambos casos se comprueba explícitamente que el paquete
 * de plataforma de Copilot está presente y, si npm no lo seleccionó, se instala a propósito.
 */
async function installModules(app) {
  const hostMatches = process.platform === platform && process.arch === "x64";
  const fresh = args.includes("--fresh") || !hostMatches;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const platformEnv = { ...process.env, npm_config_os: platform, npm_config_cpu: "x64", npm_config_ignore_scripts: "true" };
  if (platform === "linux") platformEnv.npm_config_libc = "glibc";
  const projectNpmrc = path.join(root, ".npmrc");
  if (existsSync(projectNpmrc)) await copyFile(projectNpmrc, path.join(app, ".npmrc"));

  if (!fresh) {
    const source = path.join(root, "node_modules");
    if (!existsSync(path.join(source, "@github", "copilot-sdk"))) throw new Error("No hay node_modules/ probado en el checkout. Ejecuta npm run setup antes, o usa --fresh.");
    log("Copiando node_modules del checkout (árbol ya probado, como FENIX)…");
    await cp(source, path.join(app, "node_modules"), { recursive: true });
    const prune = spawnSync(npm, ["prune", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel", "error"], { cwd: app, stdio: "inherit", env: platformEnv, shell: process.platform === "win32" });
    if (prune.status === 0) log("Dependencias de desarrollo retiradas del payload (npm prune --omit=dev).");
    else log("Aviso: npm prune falló; el payload conserva las dependencias de desarrollo (no afecta al funcionamiento).");
  } else {
    log(`Instalando dependencias de producción para ${platform}-x64 desde el registro…`);
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "install-deps.mjs"), "--production", "--cwd", app], { stdio: "inherit", env: platformEnv });
    if (result.status !== 0) throw new Error("npm install falló en el payload.");
  }

  if (edition.runtime === "codex") {
    await installCodexRuntime(app, platformEnv);
    await pruneCopilotRuntime(app);
    await rm(path.join(app, "package-lock.json"), { force: true });
    await rm(path.join(app, ".npmrc"), { force: true });
    return;
  }

  const packageName = copilotPlatformPackage();
  if (!existsSync(path.join(app, "node_modules", "@github", `copilot-${platform}-x64`))) {
    const version = await readInstalledVersion(app, "@github/copilot");
    log(`npm no dejó ${packageName} en el payload; se instala explícitamente${version ? ` (${version})` : ""}…`);
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "install-deps.mjs"), "--production", "--cwd", app, "--packages", `${packageName}${version ? `@${version}` : ""}`], { stdio: "inherit", env: platformEnv });
    if (result.status !== 0 || !existsSync(path.join(app, "node_modules", "@github", `copilot-${platform}-x64`))) {
      const listing = spawnSync(npm, ["ls", "@github/copilot", "--depth=1"], { cwd: app, encoding: "utf8", env: platformEnv, shell: process.platform === "win32" });
      process.stdout.write(`${listing.stdout || ""}${listing.stderr || ""}`);
      throw new Error(`Falta ${packageName} en el payload y no se pudo instalar. Revisa la salida de npm anterior.`);
    }
  }
  log(`Paquete Copilot de plataforma: ${packageName} ${await readInstalledVersion(app, packageName)}.`);
  await pruneForeignCopilotRuntimes(app);
  await pruneCodexRuntime(app);
  await rm(path.join(app, "package-lock.json"), { force: true });
  await rm(path.join(app, ".npmrc"), { force: true });
}

/**
 * Codex es una dependencia opcional del repositorio, así que el árbol copiado lo trae aunque se esté
 * construyendo KDD Studio, que habla con Copilot. Son otros 300 MB que nadie va a abrir.
 */
async function pruneCodexRuntime(app) {
  const dir = path.join(app, "node_modules", "@openai");
  if (!existsSync(dir)) return;
  await rm(dir, { recursive: true, force: true });
  await rm(path.join(app, "node_modules", ".bin", "codex"), { force: true });
  log("Retirado @openai/codex: KDD Studio habla con Copilot.");
}

/**
 * Cada runtime de Copilot ocupa unos 300 MB. Si el árbol copiado trae los de otras plataformas (pasa
 * al construir el payload de Windows desde Linux, o al revés), sobran: se van y el instalador
 * adelgaza otro tanto.
 */
async function pruneForeignCopilotRuntimes(app) {
  const dir = path.join(app, "node_modules", "@github");
  if (!existsSync(dir)) return;
  const keep = `copilot-${platform}-x64`;
  for (const entry of await readdir(dir)) {
    if (!/^copilot-(win32|linux|linuxmusl|darwin)-/.test(entry) || entry === keep) continue;
    await rm(path.join(dir, entry), { recursive: true, force: true });
    // El enlace de node_modules/.bin quedaría colgando y rompe el empaquetado.
    await rm(path.join(app, "node_modules", ".bin", entry.replace(/^copilot-/, "copilot-")), { force: true });
    log(`Retirado ${entry}: no es de la plataforma de destino.`);
  }
}

async function stageNode() {
  if (args.includes("--skip-node") || platform !== "win32") {
    log("Se omite el Node portable.");
    return;
  }
  const nodeDir = path.join(target, "runtime", "node");
  await mkdir(cache, { recursive: true });
  const zip = path.join(cache, path.basename(tools.node.url));
  if (!existsSync(zip)) {
    log(`Descargando Node ${tools.node.version} para Windows…`);
    await download(tools.node.url, zip);
  }
  await mkdir(nodeDir, { recursive: true });
  const count = extractZip(await readFile(zip), nodeDir, { stripPrefix: true });
  log(`Node portable extraído (${count} ficheros).`);
}

async function stageScaffold() {
  for (const folder of ["data", "outputs", "knowledge-bases", "runtime"]) await mkdir(path.join(target, folder), { recursive: true });
  await writeFile(path.join(target, "kdd-root.json"), JSON.stringify({ product: "KDD Studio", version: pkg.version, builtAt: new Date().toISOString() }, null, 2));
  await writeFile(path.join(target, "knowledge-bases", "LEEME.txt"), "Carpeta sugerida para tus bases de conocimiento KDD. Puedes usar cualquier otra desde KDD Studio > Gestionar.\n");
  await writeFile(path.join(target, "outputs", "LEEME.txt"), "Aquí deja el BBVA CIB Assistant los ficheros que genera.\n");
  const cmd = [
    "@echo off",
    "setlocal",
    "set ROOT=%~dp0",
    "if exist \"%ROOT%runtime\\gh\\bin\" set PATH=%ROOT%runtime\\gh\\bin;%PATH%",
    "if exist \"%ROOT%runtime\\git\\cmd\" set PATH=%ROOT%runtime\\git\\cmd;%PATH%",
    "if exist \"%ROOT%runtime\\node\\node.exe\" (set NODE=%ROOT%runtime\\node\\node.exe) else (set NODE=node)",
    "\"%NODE%\" \"%ROOT%app\\src\\cli.mjs\" start %*",
    "if errorlevel 1 pause",
    "endlocal",
  ].join("\r\n");
  await writeFile(path.join(target, "KDD Studio.cmd"), `${cmd}\r\n`);
  // Ejecuta el launcher con la ventana fija: si KDD-Studio.exe no llega ni a arrancar (por ejemplo, si el
  // equipo bloquea el binario), el mensaje queda a la vista en vez de cerrarse la consola.
  const diagnostic = [
    "@echo off",
    "setlocal",
    "title KDD Studio - diagnostico",
    "echo Ejecutando KDD-Studio.exe con la ventana fija. El registro completo queda en data\\logs\\launcher.log",
    "echo.",
    "\"%~dp0KDD-Studio.exe\" %*",
    "echo.",
    "echo KDD-Studio.exe ha terminado con codigo %ERRORLEVEL%.",
    "pause",
    "endlocal",
  ].join("\r\n");
  await writeFile(path.join(target, "KDD Studio-Diagnostico.cmd"), `${diagnostic}\r\n`);
  let commit = "";
  try {
    commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  } catch { /* sin git */ }
  await writeFile(path.join(target, "BUILD.json"), JSON.stringify({ product: "KDD Studio", version: pkg.version, platform, commit, builtAt: new Date().toISOString(), node: tools.node.version }, null, 2));
}

/**
 * El payload ocupa ~600 MB y el instalador otros ~750 MB (zip + exe); npm además cachea el runtime
 * de Copilot (~300 MB). Sin espacio, npm descarta el paquete de plataforma en silencio por ser
 * opcional, así que se comprueba antes de empezar.
 */
export async function ensureFreeSpace(directory, requiredBytes, label) {
  const { statfs } = await import("node:fs/promises");
  let probe = directory;
  while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  try {
    const info = await statfs(probe);
    const free = Number(info.bavail) * Number(info.bsize);
    const gb = (value) => (value / (1024 ** 3)).toFixed(1);
    if (free < requiredBytes) {
      throw new Error(`Espacio insuficiente en ${probe}: ${gb(free)} GB libres y ${label} necesita al menos ${gb(requiredBytes)} GB. Libera espacio (npm cache clean --force, borrar dist/) o construye en otra unidad con KDD_DIST=<carpeta>.`);
    }
    log(`Espacio libre en ${probe}: ${gb(free)} GB.`);
  } catch (error) {
    if (/Espacio insuficiente/.test(error.message)) throw error;
    log(`No se pudo comprobar el espacio libre (${error.message}); se continúa.`);
  }
}

async function main() {
  if (!args.includes("--allow-low-space")) await ensureFreeSpace(dist, 2.5 * 1024 ** 3, "build:dist");
  // Solo se limpia la carpeta de esta edición: `build:all` construye las dos seguidas y borrar
  // dist entero se llevaría por delante la que ya estaba hecha.
  log(`Limpiando ${target}…`);
  await rm(target, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await mkdir(target, { recursive: true });
  const app = await stageApp();
  await installModules(app);
  await stageNode();
  await stageScaffold();
  const size = await folderSize(target);
  log(`Payload listo en ${target} (${(size / (1024 * 1024)).toFixed(0)} MB).`);
}

async function folderSize(dir) {
  const { readdir } = await import("node:fs/promises");
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[build-dist] ${error.message}`);
    process.exit(1);
  });
}
