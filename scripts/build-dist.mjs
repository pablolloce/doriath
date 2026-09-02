#!/usr/bin/env node
/**
 * Construye el payload de distribución en dist/Doriath:
 *   app/          código + node_modules de producción (paquete Copilot de Windows x64)
 *   runtime/node/ Node.js portable para Windows
 *   data/ outputs/ knowledge-bases/  carpetas vacías (las crea también el instalador)
 *   doriath-root.json, Doriath.cmd, BUILD.json
 *
 * Opciones: --fresh (reinstala node_modules desde el registro en vez de copiar el árbol probado),
 *           --skip-node (no descarga Node), --platform linux (payload Linux para pruebas)
 */
import { cp, mkdir, rm, writeFile, readFile, copyFile, stat } from "node:fs/promises";
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
const dist = path.join(root, "dist");
const target = path.join(dist, "Doriath");
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
  log("Código de la aplicación copiado.");
  return app;
}

function copilotPlatformPackage() {
  return `@github/copilot-${platform}-x64`;
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
  await rm(path.join(app, "package-lock.json"), { force: true });
  await rm(path.join(app, ".npmrc"), { force: true });
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
  await writeFile(path.join(target, "doriath-root.json"), JSON.stringify({ product: "Doriath", version: pkg.version, builtAt: new Date().toISOString() }, null, 2));
  await writeFile(path.join(target, "knowledge-bases", "LEEME.txt"), "Carpeta sugerida para tus bases de conocimiento KDD. Puedes usar cualquier otra desde Doriath > Gestionar.\n");
  await writeFile(path.join(target, "outputs", "LEEME.txt"), "Aquí deja el BBVA CIB Assistant los ficheros que genera.\n");
  const cmd = [
    "@echo off",
    "setlocal",
    "set ROOT=%~dp0",
    "set DORIATH_LAUNCHER_PID=%RANDOM%",
    "if exist \"%ROOT%runtime\\gh\\bin\" set PATH=%ROOT%runtime\\gh\\bin;%PATH%",
    "if exist \"%ROOT%runtime\\git\\cmd\" set PATH=%ROOT%runtime\\git\\cmd;%PATH%",
    "if exist \"%ROOT%runtime\\node\\node.exe\" (set NODE=%ROOT%runtime\\node\\node.exe) else (set NODE=node)",
    "\"%NODE%\" \"%ROOT%app\\src\\cli.mjs\" start %*",
    "endlocal",
  ].join("\r\n");
  await writeFile(path.join(target, "Doriath.cmd"), `${cmd}\r\n`);
  let commit = "";
  try {
    commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  } catch { /* sin git */ }
  await writeFile(path.join(target, "BUILD.json"), JSON.stringify({ product: "Doriath", version: pkg.version, platform, commit, builtAt: new Date().toISOString(), node: tools.node.version }, null, 2));
}

async function main() {
  log(`Limpiando ${dist}…`);
  await rm(dist, { recursive: true, force: true });
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

main().catch((error) => {
  console.error(`[build-dist] ${error.message}`);
  process.exit(1);
});
