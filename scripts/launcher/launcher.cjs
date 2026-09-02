"use strict";
/**
 * Doriath.exe — launcher (Node SEA). Vive en la raíz de la instalación:
 *
 *   <raiz>/
 *   ├── Doriath.exe          este launcher
 *   ├── doriath-root.json    marcador de instalación
 *   ├── app/                 código de Doriath + node_modules
 *   ├── runtime/node/        Node.js portable (node.exe)
 *   ├── runtime/gh, git/     GitHub CLI y MinGit portables (si no estaban en el equipo)
 *   ├── data/ outputs/ knowledge-bases/
 *
 * Pasos: localizar Node portable, asegurar gh y git (descarga portable si faltan), comprobar la sesión
 * de gh (si no la hay, abre `gh auth login` en esta misma consola), lanzar el servidor y abrir Chrome.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const { download } = require("./download.cjs");
const { extractZip } = require("./zip.cjs");
const tools = require("./tools.json");

const isWindows = process.platform === "win32";
const root = process.env.DORIATH_ROOT ? path.resolve(process.env.DORIATH_ROOT) : fs.existsSync(path.join(path.dirname(process.execPath), "doriath-root.json")) ? path.dirname(process.execPath) : path.resolve(__dirname, "..", "..", "dist", "Doriath");
const appDir = path.join(root, "app");
const runtimeDir = path.join(root, "runtime");

function log(message) {
  process.stdout.write(`[Doriath] ${message}\n`);
}

function which(command) {
  const result = spawnSync(isWindows ? "where" : "which", [command], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return "";
  return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
}

function nodeExecutable() {
  const portable = path.join(runtimeDir, "node", isWindows ? "node.exe" : "bin/node");
  if (fs.existsSync(portable)) return portable;
  const system = which("node");
  if (system) return system;
  return "";
}

async function ensurePortableTool(name) {
  const spec = tools[name];
  const dir = path.join(runtimeDir, name);
  const binary = path.join(dir, spec.bin);
  if (fs.existsSync(binary)) return path.dirname(binary);
  const system = which(name);
  if (system) return "";
  if (!isWindows) {
    log(`No se encuentra ${name}; instálalo con el gestor de paquetes del sistema.`);
    return "";
  }
  log(`Descargando ${name} ${spec.version} (portable)…`);
  const zipPath = path.join(runtimeDir, `${name}.zip`);
  await download(spec.url, zipPath, { onProgress: (received, total) => { if (total) process.stdout.write(`\r[Doriath] ${name}: ${Math.round((received / total) * 100)}%   `); } });
  process.stdout.write("\n");
  fs.mkdirSync(dir, { recursive: true });
  extractZip(fs.readFileSync(zipPath), dir, { stripPrefix: spec.stripPrefix });
  fs.rmSync(zipPath, { force: true });
  return fs.existsSync(binary) ? path.dirname(binary) : "";
}

function readConfigHost() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, "data", "config.json"), "utf8"));
    return config?.github?.host || "bbva.ghe.com";
  } catch {
    return "bbva.ghe.com";
  }
}

function ensureGitHubSession(env) {
  const host = readConfigHost();
  const status = spawnSync("gh", ["auth", "status", "--hostname", host], { env, encoding: "utf8", windowsHide: true });
  if (status.status === 0) {
    log(`Sesión de GitHub (${host}) activa.`);
    return true;
  }
  log(`No hay sesión de GitHub en ${host}. Se abre el inicio de sesión (usa tu correo de BBVA en el navegador).`);
  const login = spawnSync("gh", ["auth", "login", "--hostname", host, "--web", "--git-protocol", "https"], { env, stdio: "inherit" });
  if (login.status === 0) {
    spawnSync("gh", ["auth", "setup-git", "--hostname", host], { env, stdio: "inherit" });
    return true;
  }
  log("El inicio de sesión no se completó. Podrás iniciarla desde la propia aplicación.");
  return false;
}

async function main() {
  log(`Instalación: ${root}`);
  if (!fs.existsSync(path.join(appDir, "src", "cli.mjs"))) {
    throw new Error(`No se encuentra la aplicación en ${appDir}. Vuelve a ejecutar el instalador.`);
  }
  const env = { ...process.env, DORIATH_LAUNCHER_PID: String(process.pid) };
  const extraPath = [];
  for (const tool of ["gh", "git"]) {
    try {
      const binDir = await ensurePortableTool(tool);
      if (binDir) extraPath.push(binDir);
    } catch (error) {
      log(`No se pudo preparar ${tool}: ${error.message}`);
    }
  }
  if (extraPath.length) env.PATH = [...extraPath, env.PATH || ""].join(path.delimiter);
  const node = nodeExecutable();
  if (!node) throw new Error("No se encuentra Node.js (runtime/node). Vuelve a ejecutar el instalador.");
  ensureGitHubSession(env);
  log("Arrancando el servidor local…");
  const child = spawn(node, [path.join(appDir, "src", "cli.mjs"), "start"], { cwd: appDir, env, stdio: "inherit", windowsHide: false });
  child.on("exit", (code) => {
    log(`Servidor finalizado (${code}). Puedes cerrar esta ventana.`);
    process.exit(code || 0);
  });
  process.on("SIGINT", () => child.kill());
}

main().catch((error) => {
  process.stderr.write(`[Doriath] ${error.message}\n`);
  if (isWindows) spawnSync("cmd.exe", ["/c", "pause"], { stdio: "inherit" });
  process.exit(1);
});
