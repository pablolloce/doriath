"use strict";
/**
 * KDD-Studio.exe — launcher (Node SEA). Vive en la raíz de la instalación:
 *
 *   <raiz>/
 *   ├── KDD-Studio.exe          este launcher
 *   ├── kdd-root.json    marcador de instalación
 *   ├── app/                 código de KDD Studio + node_modules
 *   ├── runtime/node/        Node.js portable (node.exe)
 *   ├── runtime/gh, git/     GitHub CLI y MinGit portables (si no estaban en el equipo)
 *   ├── data/ outputs/ knowledge-bases/
 *
 * Pasos (calcados de launch.ps1 e install.ps1 de FENIX): localizar Node portable, asegurar gh y git
 * (descarga portable si faltan), reparar node_modules si falta alguna dependencia (con reintento contra
 * npmjs si el Artifactory corporativo rechaza la descarga), comprobar la sesión de gh (si no la hay,
 * abre `gh auth login` en esta consola), lanzar el servidor y abrir Chrome cuando responda el health.
 *
 * Diagnóstico: todo lo que se imprime en la consola (incluida la salida del servidor) se copia en
 * data/logs/launcher.log, y ante cualquier fallo la ventana se queda abierta ("Pulsa una tecla")
 * como hace Wait-ForExit en FENIX. `--no-pause` (o KDD_NO_PAUSE=1) desactiva la espera.
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { download } = require("./download.cjs");
const { extractZip } = require("./zip.cjs");
const tools = require("./tools.json");


/* Inyectadas por esbuild al construir cada edición; los valores de aquí solo aplican
   si el fichero se ejecuta suelto durante el desarrollo. */
const EDITION_NAME = typeof __EDITION_NAME__ === "string" ? __EDITION_NAME__ : "KDD Studio";
const EDITION_EXE = typeof __EDITION_EXE__ === "string" ? __EDITION_EXE__ : "KDD-Studio";

const isWindows = process.platform === "win32";
const argv = process.argv.slice(1);
const noPause = argv.includes("--no-pause") || process.env.KDD_NO_PAUSE === "1";
const root = process.env.KDD_ROOT ? path.resolve(process.env.KDD_ROOT) : fs.existsSync(path.join(path.dirname(process.execPath), "kdd-root.json")) ? path.dirname(process.execPath) : path.resolve(__dirname, "..", "..", "dist", EDITION_EXE);
const appDir = path.join(root, "app");
const runtimeDir = path.join(root, "runtime");
const dataDir = path.join(root, "data");
const logFile = path.join(dataDir, "logs", "launcher.log");
const AUTH_FAILURE = /E401|E403|Forbidden|Unauthorized|Incorrect or missing password|Unable to authenticate|Artifactory Realm/i;

let serverChild = null;
let serverReady = false;
let stopping = false;

// ---------------------------------------------------------------------------------------------
// Registro y salida controlada
// ---------------------------------------------------------------------------------------------

function logToFile(text) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, text);
  } catch {
    /* el registro nunca impide arrancar */
  }
}

function log(message, { stderr = false } = {}) {
  const line = `[${EDITION_NAME}] ${message}\n`;
  (stderr ? process.stderr : process.stdout).write(line);
  logToFile(line);
}

/** Mantiene la ventana abierta hasta que el usuario pulse una tecla (solo si hay consola interactiva). */
function waitForKey(message = "Pulsa una tecla para cerrar esta ventana.") {
  if (noPause || !process.stdin.isTTY) return;
  process.stdout.write(`\n[${EDITION_NAME}] ${message}\n`);
  try {
    if (isWindows) spawnSync("cmd.exe", ["/c", "pause"], { stdio: "inherit" });
    else spawnSync("sh", ["-c", "read -r _"], { stdio: "inherit" });
  } catch {
    /* sin consola */
  }
}

function fail(error, code = 1) {
  const message = error && error.message ? error.message : String(error);
  log(`ERROR: ${message}`, { stderr: true });
  if (error && error.stack) logToFile(`${error.stack}\n`);
  log(`Registro completo en ${logFile}`, { stderr: true });
  if (serverChild && serverChild.exitCode === null) {
    try { serverChild.kill(); } catch { /* ya terminado */ }
  }
  waitForKey();
  process.exit(code);
}

process.on("uncaughtException", (error) => fail(error));
process.on("unhandledRejection", (error) => fail(error));

logToFile(`\n===== ${new Date().toISOString()} · ${argv.join(" ") || process.execPath} =====\n`);
logToFile(`exec=${process.execPath} node=${process.version} platform=${process.platform}-${process.arch} cwd=${process.cwd()} root=${root}\n`);

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

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
  const proxy = String(config?.network?.proxyUrl || process.env.KDD_PROXY || "").trim();
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

/** Con shell (necesario para .cmd en Windows) la ruta del ejecutable debe ir entrecomillada si lleva espacios. */
function shellSafe(command) {
  return isWindows && /\s/.test(command) && !command.startsWith('"') ? `"${command}"` : command;
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
  fs.mkdirSync(runtimeDir, { recursive: true });
  await download(spec.url, zipPath, { onProgress: (received, total) => { if (total) process.stdout.write(`\r[${EDITION_NAME}] ${name}: ${Math.round((received / total) * 100)}%   `); } });
  process.stdout.write("\n");
  fs.mkdirSync(dir, { recursive: true });
  extractZip(fs.readFileSync(zipPath), dir, { stripPrefix: spec.stripPrefix });
  fs.rmSync(zipPath, { force: true });
  if (!fs.existsSync(binary)) return "";
  const binDir = path.dirname(binary);
  if (name === "gh") addToUserPath(binDir);
  log(`${name} ${spec.version} disponible en ${binDir}`);
  return binDir;
}

// ---------------------------------------------------------------------------------------------
// Dependencias de la aplicación
// ---------------------------------------------------------------------------------------------

const COPILOT_PLATFORM_PACKAGE = `@github/copilot-${process.platform}-${process.arch}`;

function installed(name) {
  return fs.existsSync(path.join(appDir, "node_modules", ...name.split("/"), "package.json"));
}

function dependenciesReady() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
    return Object.keys(manifest.dependencies || {}).every(installed);
  } catch {
    return false;
  }
}

function runNpm(npm, npmArgs, env) {
  log(`npm ${npmArgs.join(" ")}`);
  const result = spawnSync(shellSafe(npm), npmArgs, { cwd: appDir, env, encoding: "utf8", shell: isWindows, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.error) log(`No se pudo ejecutar npm: ${result.error.message}`, { stderr: true });
  if (result.status !== 0) {
    process.stdout.write(output);
    logToFile(output);
  }
  return { ok: result.status === 0, output };
}

/** npm install con el mismo reintento que install.ps1 de FENIX (Artifactory -> npmjs con CA del sistema). */
function npmInstallWithFallback(node, env, extraArgs, label) {
  const npm = npmCommand(node);
  const withNode = { ...env, PATH: [path.dirname(node), env.PATH || ""].join(path.delimiter) };
  const base = ["install", "--omit=dev", "--ignore-scripts", "--loglevel", "error", "--no-fund", ...extraArgs];
  const first = runNpm(npm, base, withNode);
  if (first.ok) return;
  if (!AUTH_FAILURE.test(first.output)) throw new Error(`${label}: npm install falló. Revisa los mensajes anteriores.`);
  log("El registro corporativo rechazó la descarga. Reintentando desde npmjs con los certificados de Windows…");
  const second = runNpm(npm, [...base, "--registry", "https://registry.npmjs.org/", "--package-lock=false", "--no-audit"], { ...withNode, NODE_OPTIONS: [withNode.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ") });
  if (!second.ok) throw new Error(`${label}: npm install falló también contra registry.npmjs.org.`);
}

/** Repara node_modules: dependencias declaradas y runtime Copilot de esta plataforma. */
function repairDependencies(node, env) {
  if (!dependenciesReady()) {
    log("Faltan dependencias en app/node_modules; instalando (npm install)…");
    npmInstallWithFallback(node, env, [], "dependencias");
  }
  if (!installed(COPILOT_PLATFORM_PACKAGE)) {
    let version = "";
    try {
      version = JSON.parse(fs.readFileSync(path.join(appDir, "node_modules", "@github", "copilot", "package.json"), "utf8")).version;
    } catch { /* sin versión */ }
    log(`Falta ${COPILOT_PLATFORM_PACKAGE} (runtime de Copilot); instalándolo explícitamente…`);
    npmInstallWithFallback(node, env, ["--no-save", "--force", `${COPILOT_PLATFORM_PACKAGE}${version ? `@${version}` : ""}`], "runtime Copilot");
    if (!installed(COPILOT_PLATFORM_PACKAGE)) throw new Error(`No se pudo instalar ${COPILOT_PLATFORM_PACKAGE}. Copilot no funcionará hasta resolverlo.`);
  }
}

// ---------------------------------------------------------------------------------------------
// Sesión de GitHub y servidor
// ---------------------------------------------------------------------------------------------

function ensureGitHubSession(env, host) {
  const status = spawnSync("gh", ["auth", "status", "--hostname", host], { env, encoding: "utf8", windowsHide: true, shell: isWindows });
  if (status.status === 0) {
    log(`Sesión de GitHub (${host}) activa.`);
    return true;
  }
  if (status.error) {
    log(`No se pudo ejecutar gh (${status.error.message}). Podrás iniciar sesión desde la propia aplicación.`);
    return false;
  }
  logToFile(`${status.stdout || ""}\n${status.stderr || ""}`);
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
      if (serverChild && serverChild.exitCode !== null) {
        resolve(false);
        return;
      }
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

function startServer(node, env, port) {
  const child = spawn(node, [path.join(appDir, "src", "cli.mjs"), "start"], { cwd: appDir, env, stdio: ["inherit", "pipe", "pipe"], windowsHide: false });
  serverChild = child;
  // La salida del servidor se muestra en la consola y se copia al registro del launcher.
  child.stdout.on("data", (chunk) => { process.stdout.write(chunk); logToFile(chunk); });
  child.stderr.on("data", (chunk) => { process.stderr.write(chunk); logToFile(chunk); });
  child.on("error", (error) => fail(new Error(`No se pudo arrancar Node (${node}): ${error.message}`)));
  child.on("exit", (code, signal) => {
    if (stopping) {
      log("Servidor detenido.");
      process.exit(0);
    }
    if (code === 0 && serverReady) {
      log("Servidor finalizado. Puedes cerrar esta ventana.");
      process.exit(0);
    }
    if (code === 0) {
      // El servidor salió sin llegar al health: normalmente porque ya había una instancia en marcha y
      // solo ha abierto una pestaña (main.mjs, reused).
      log(`El servidor ha terminado antes de responder. Si KDD Studio ya estaba abierto, se ha abierto una pestaña nueva; si no ves nada, entra en http://127.0.0.1:${port}/ o revisa ${logFile}.`);
      waitForKey();
      process.exit(0);
    }
    log(`El servidor se ha detenido (código ${code ?? signal}). Revisa los mensajes anteriores y ${logFile}.`, { stderr: true });
    waitForKey();
    process.exit(code || 1);
  });
  return child;
}

async function main() {
  log(`Instalación: ${root}`);
  if (!fs.existsSync(path.join(appDir, "src", "cli.mjs"))) {
    throw new Error(`No se encuentra la aplicación en ${appDir}. Vuelve a ejecutar el instalador.`);
  }
  const config = readConfig();
  const env = applyProxy({ ...process.env, KDD_LAUNCHER_PID: String(process.pid) }, config);
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
  log(`Node: ${node}`);
  repairDependencies(node, env);
  ensureGitHubSession(env, config?.github?.host || "bbva.ghe.com");
  const port = Number(process.env.KDD_PORT || config?.server?.port || 4410);
  log("Arrancando el servidor local…");
  startServer(node, env, port);
  process.on("SIGINT", () => {
    stopping = true;
    if (serverChild && serverChild.exitCode === null) serverChild.kill();
  });
  const healthy = await waitForHealth(port);
  if (healthy) {
    serverReady = true;
    log(`KDD-Studio disponible en http://127.0.0.1:${port}/ (esta ventana muestra los registros; ciérrala para detenerlo).`);
  } else if (serverChild && serverChild.exitCode === null) {
    log("El servidor tarda más de lo esperado; revisa los mensajes anteriores.");
  }
}

main().catch((error) => fail(error));
