import process from "node:process";
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { runCommand } from "../util/process.mjs";
import { openLoginConsole, quoteArgument } from "../util/console.mjs";
import { paths } from "../paths.mjs";
import { log } from "../util/log.mjs";

/**
 * Sesión de ChatGPT tomada de la CLI de Codex, con la misma forma que la de `gh` para Copilot:
 * KDD Assistant no guarda credenciales propias. Quien inicia sesión es `codex login`, que abre el
 * navegador contra ChatGPT y deja el resultado en `~/.codex`. Aquí solo se consulta el estado.
 *
 * El cupo que se gasta es el del plan de ChatGPT de la persona, y lo comparte con su propio ChatGPT
 * y con su extensión del IDE: es una ventana móvil, no un contador aparte. Conviene decirlo en la
 * interfaz, porque agotarlo aquí deja a alguien sin ChatGPT el resto de la ventana.
 */
const TTL_MS = 30_000;
let cached = null;

/**
 * Localiza el binario de Codex. Igual que con `gh`, el PATH del servidor es el que heredó al
 * arrancar: si alguien instala Codex con la aplicación ya abierta, ese PATH se queda antiguo. Se
 * prueba también la copia que viaja dentro del instalador y las rutas habituales de npm global.
 */
let codexPath = "";
export async function codexCommand() {
  if (codexPath && (codexPath === "codex" || existsSync(codexPath))) return codexPath;

  // La copia que empaqueta el instalador: es la que garantiza que funcione sin instalar nada.
  const bundled = bundledCodex();
  if (bundled) {
    codexPath = bundled;
    return codexPath;
  }
  const probe = await runCommand("codex", ["--version"], { timeoutMs: 15000 });
  if (probe.ok) {
    codexPath = "codex";
    return codexPath;
  }
  if (process.platform === "win32") {
    const candidates = [
      paths.runtimeDir ? path.join(paths.runtimeDir, "codex", "codex.exe") : "",
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "codex.cmd") : "",
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "codex", "codex.exe") : "",
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      log.info("auth", `Codex encontrado fuera del PATH: ${candidate}`);
      codexPath = candidate;
      return codexPath;
    }
  }
  codexPath = "codex";
  return codexPath;
}

/** El binario que viaja con la aplicación, resuelto desde el paquete npm que empaqueta el build. */
function bundledCodex() {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("@openai/codex/bin/codex.js", { paths: [paths.appRoot] });
    return existsSync(entry) ? entry : "";
  } catch {
    return "";
  }
}

async function codex(args, options = {}) {
  const command = await codexCommand();
  // El lanzador de npm es un .js: hay que ejecutarlo con Node, no como binario suelto.
  if (command.endsWith(".js")) return runCommand(process.execPath, [command, ...args], { timeoutMs: 20000, ...options });
  return runCommand(command, args, { timeoutMs: 20000, ...options });
}

/**
 * Estado de la sesión. `codex login status` responde con una línea legible; se interpreta esa, no
 * el código de salida, porque «no hay sesión» no es un fallo de ejecución.
 */
export async function inspectCodex() {
  const version = await codex(["--version"]);
  if (!version.ok) {
    return {
      installed: false,
      authenticated: false,
      error: version.error || "Codex no está instalado.",
      account: "",
      authOutput: "",
      executable: await codexCommand(),
    };
  }
  const cliVersion = String(version.stdout || "").trim();
  const status = await codex(["login", "status"]);
  const output = `${status.stdout || ""}${status.stderr || ""}`.trim();
  const loggedOut = /not logged in|no has iniciado|sin sesión/i.test(output);
  const authenticated = status.ok && !loggedOut && output.length > 0;
  return {
    installed: true,
    authenticated,
    version: cliVersion,
    // La línea suele traer el correo o el tipo de cuenta; se enseña tal cual en la interfaz.
    account: authenticated ? output.replace(/^logged in( as)?:?\s*/i, "").split("\n")[0].trim() : "",
    error: authenticated ? "" : (loggedOut ? "" : status.error || ""),
    authOutput: output,
    executable: await codexCommand(),
  };
}

export async function getCodexStatus({ refresh = false } = {}) {
  if (!refresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await inspectCodex();
  cached = { at: Date.now(), value };
  return value;
}

export function invalidateCodexCache() {
  cached = null;
  codexPath = "";
}

/**
 * Arranca el login. `codex login` abre el navegador contra ChatGPT y espera, así que se lanza en una
 * consola aparte para no bloquear el servidor, igual que se hace con `gh auth login`.
 *
 * La orden se escribe en un fichero y se abre el fichero (ver `openLoginConsole`): el Codex que viaja
 * en el instalador es un .js que hay que ejecutar con Node, de modo que la línea lleva dos rutas
 * entrecomilladas dentro y pasársela a cmd.exe como argumento la rompía siempre.
 */
export async function startCodexLogin() {
  const command = await codexCommand();
  const line = command.endsWith(".js")
    ? `${quoteArgument(process.execPath)} ${quoteArgument(command)} login`
    : `${quoteArgument(command)} login`;
  const result = openLoginConsole({
    id: "codex-login",
    title: "KDD Assistant - Inicio de sesion con ChatGPT",
    lines: [line],
    note: "Sesion iniciada. Puedes cerrar esta ventana y volver a KDD Assistant.",
  });
  invalidateCodexCache();
  return { ...result, command: line };
}

/** Cierra la sesión de ChatGPT. Lo hace la propia CLI: aquí solo se invoca y se olvida la caché. */
export async function logoutCodex() {
  const result = await codex(["logout"]);
  invalidateCodexCache();
  if (!result.ok) throw new Error(result.error || "No se ha podido cerrar la sesión de ChatGPT.");
  return { ok: true, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
}
