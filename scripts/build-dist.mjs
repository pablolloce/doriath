#!/usr/bin/env node
/**
 * Construye el payload de distribución en dist/Doriath:
 *   app/          código + node_modules de producción (paquete Copilot de Windows x64)
 *   runtime/node/ Node.js portable para Windows
 *   data/ outputs/ knowledge-bases/  carpetas vacías (las crea también el instalador)
 *   doriath-root.json, Doriath.cmd, BUILD.json
 *
 * Opciones: --skip-node (no descarga Node), --skip-modules (copia node_modules actual), --platform linux
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

async function installModules(app) {
  if (args.includes("--skip-modules")) {
    await cp(path.join(root, "node_modules"), path.join(app, "node_modules"), { recursive: true });
    log("node_modules copiado del checkout (sin adaptar a Windows).");
    return;
  }
  log(`Instalando dependencias de producción para ${platform}-x64…`);
  // Reutiliza el .npmrc de proyecto generado por scripts/install-deps.mjs (registro alternativo y
  // certificados del sistema) para que el payload se pueda construir dentro de la red corporativa.
  const projectNpmrc = path.join(root, ".npmrc");
  if (existsSync(projectNpmrc)) await copyFile(projectNpmrc, path.join(app, ".npmrc"));
  const caFile = path.join(root, ".cache", "system-ca-bundle.pem");
  const certEnv = existsSync(caFile) ? { NODE_EXTRA_CA_CERTS: caFile } : {};
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], {
    cwd: app,
    stdio: "inherit",
    env: { ...process.env, ...certEnv, npm_config_os: platform, npm_config_cpu: "x64", npm_config_libc: platform === "linux" ? "glibc" : "" },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error("npm install falló en el payload.");
  const copilotDir = path.join(app, "node_modules", "@github", `copilot-${platform}-x64`);
  if (!existsSync(copilotDir)) throw new Error(`Falta el paquete @github/copilot-${platform}-x64 en el payload.`);
  log(`Paquete Copilot de plataforma: ${path.basename(copilotDir)}.`);
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
