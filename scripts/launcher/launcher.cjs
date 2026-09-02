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
 * Pasos (calcados de launch.ps1 e install.ps1 de FENIX): localizar Node portable, asegurar gh y git
 * (descarga portable si faltan), reparar node_modules si falta alguna dependencia (con reintento contra
 * npmjs si el Artifactory corporativo rechaza la descarga), comprobar la sesión de gh (si no la hay,
 * abre `gh auth login` en esta consola), lanzar el servidor y abrir Chrome cuando responda el health.
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { download } = require("./download.cjs");
const { extractZip } = require("./zip.cjs");
const tools = require("./tools.json");

const isWindows = process.platform === "win32";
const root = process.env.DORIATH_ROOT ? path.resolve(process.env.DORIATH_ROOT) : fs.existsSync(path.join(path.dirname(process.execPath), "doriath-root.json")) ? path.dirname(process.execPath) : path.resolve(__dirname, "..", "..", "dist", "Doriath");
const appDir = path.join(root, "app");
const runtimeDir = path.join(root, "runtime");
const dataDir = path.join(root, "data");
const AUTH_FAILURE = /E401|E403|Forbidden|Unauthorized|Incorrect or missing password|Unable to authenticate|Artifactory Realm/i;

function log(message) {
  process.stdout.write(`[Doriath] ${message}\n`);
}

function which(command) {
  const result = spawnSync(isWindows ? "where" : "which", [command], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return "";
  return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8")) || {};
  } catch {
    return {};
  }
}

function applyProxy(env, config) {
  const proxy = String(config?.network?.proxyUrl || process.env.DORIATH_PROXY || "").trim();
  if (!proxy) return env;
  for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) env[key] = proxy;
  env.NO_PROXY = String(config?.network?.noProxy || "127.0.0.1,localhost");
  log(`Proxy de salida: ${proxy}`);
  return env;
}

function nodeExecutable() {
  const portable = path.join(runtimeDir, "node", isWindows ? "node.exe" : "bin/node");
  if (fs.existsSync(portable)) return portable;
  return which("node");
}

function npmCommand(node) {
  const portable = path.join(path.dirname(node), isWindows ? "npm.cmd" : "npm");
  if (fs.existsSync(portable)) return portable;
  return isWindows ? "npm.cmd" : "npm";
}

/** Añade una carpeta al PATH del usuario (persistente, sin permisos de administrador), como install.ps1. */
function addToUserPath(dir) {
  if (!isWindows) return;
  const script = `$p = [Environment]::GetEnvironmentVariable('Path', 'User'); if (($p -split ';') -notcontains '${dir.replace(/'/g, "''")}') { [Environment]::SetEnvironmentVariable('Path', ($(if ($p) { "$p;" } else { '' }) + '${dir.replace(/'/g, "''")}'), 'User') }`;
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
}

async function ensurePortableTool(name) {
  const spec = tools[name];
  const dir = path.join(runtimeDir, name);
  const binary = path.join(dir, spec.bin);
  if (fs.existsSync(binary)) return path.dirname(binary);
  if (which(name)) return "";
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
  if (!fs.existsSync(binary)) return "";
  const binDir = path.dirname(binary);
  if (name === "gh") addToUserPath(binDir);
  return binDir;
}

function dependenciesReady() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
    return Object.keys(manifest.dependencies || {}).every((name) => fs.existsSync(path.join(appDir, "node_modules", ...name.split("/"), "package.json")));
  } catch {
    return false;
  }
}

function runNpm(npm, npmArgs, env) {
  log(`npm ${npmArgs.join(" ")}`);
  const result = spawnSync(npm, npmArgs, { cwd: appDir, env, encoding: "utf8", shell: isWindows, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== 0) process.stdout.write(output);
  return { ok: result.status === 0, output };
}

/** Repara node_modules con el mismo reintento que install.ps1 de FENIX. */
function repairDependencies(node, env) {
  if (dependenciesReady()) return;
  log("Faltan dependencias en app/node_modules; instalando (npm install)…");
  const npm = npmCommand(node);
  const withNode = { ...env, PATH: [path.dirname(node), env.PATH || ""].join(path.delimiter) };
  const first = runNpm(npm, ["install", "--omit=dev", "--ignore-scripts", "--loglevel", "error", "--no-fund"], withNode);
  if (first.ok) return;
  if (!AUTH_FAILURE.test(first.output)) throw new Error("npm install falló. Revisa los mensajes anteriores.");
  log("El registro corporativo rechazó la descarga. Reintentando desde npmjs con los certificados de Windows…");
  const second = runNpm(npm, ["install", "--omit=dev", "--ignore-scripts", "--registry", "https://registry.npmjs.org/", "--package-lock=false", "--no-audit", "--loglevel", "error", "--no-fund"], { ...withNode, NODE_OPTIONS: [withNode.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ") });
  if (!second.ok) throw new Error("npm install falló también contra registry.npmjs.org.");
}

function ensureGitHubSession(env, host) {
  const status = spawnSync("gh", ["auth", "status", "--hostname", host], { env, encoding: "utf8", windowsHide: true, shell: isWindows });
  if (status.status === 0) {
    log(`Sesión de GitHub (${host}) activa.`);
    return true;
  }
  log(`No hay sesión de GitHub en ${host}. Se abre el inicio de sesión: pega el código en el navegador con tu correo de BBVA.`);
  const login = spawnSync("gh", ["auth", "login", "--hostname", host, "--web", "--clipboard", "--git-protocol", "https"], { env, stdio: "inherit", shell: isWindows });
  if (login.status === 0) {
    spawnSync("gh", ["auth", "setup-git", "--hostname", host], { env, stdio: "inherit", shell: isWindows });
    return true;
  }
  log("El inicio de sesión no se completó. Podrás iniciarla desde la propia aplicación.");
  return false;
}

function waitForHealth(port, attempts = 60) {
  return new Promise((resolve) => {
    let remaining = attempts;
    const probe = () => {
      const request = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 1000 }, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve(true);
        else retry();
      });
      request.on("error", retry);
      request.on("timeout", () => { request.destroy(); retry(); });
    };
    const retry = () => {
      remaining -= 1;
      if (remaining <= 0) resolve(false);
      else setTimeout(probe, 500);
    };
    probe();
  });
}

async function main() {
  log(`Instalación: ${root}`);
  if (!fs.existsSync(path.join(appDir, "src", "cli.mjs"))) {
    throw new Error(`No se encuentra la aplicación en ${appDir}. Vuelve a ejecutar el instalador.`);
  }
  const config = readConfig();
  const env = applyProxy({ ...process.env, DORIATH_LAUNCHER_PID: String(process.pid) }, config);
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
  repairDependencies(node, env);
  ensureGitHubSession(env, config?.github?.host || "bbva.ghe.com");
  const port = Number(process.env.DORIATH_PORT || config?.server?.port || 4410);
  log("Arrancando el servidor local…");
  const child = spawn(node, [path.join(appDir, "src", "cli.mjs"), "start"], { cwd: appDir, env, stdio: "inherit", windowsHide: false });
  child.on("exit", (code) => {
    log(`Servidor finalizado (${code}). Puedes cerrar esta ventana.`);
    process.exit(code || 0);
  });
  process.on("SIGINT", () => child.kill());
  const healthy = await waitForHealth(port);
  if (healthy) log(`Doriath disponible en http://127.0.0.1:${port}/ (esta ventana muestra los registros; ciérrala para detenerlo).`);
  else log("El servidor tarda más de lo esperado; revisa los mensajes anteriores.");
}

main().catch((error) => {
  process.stderr.write(`[Doriath] ${error.message}\n`);
  if (isWindows) spawnSync("cmd.exe", ["/c", "pause"], { stdio: "inherit" });
  process.exit(1);
});
