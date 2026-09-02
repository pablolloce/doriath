import process from "node:process";
import { runCommand, spawnDetached } from "../util/process.mjs";
import { log } from "../util/log.mjs";

/**
 * Sesión GitHub tomada de la CLI `gh`, igual que FENIX: Doriath nunca guarda contraseñas ni tokens
 * propios; pide el token a `gh auth token` cuando lo necesita y lo cachea unos segundos en memoria.
 */
const TOKEN_TTL_MS = 30_000;
const tokenCache = new Map();
let statusCache = { at: 0, value: null };

export function normalizeHostname(host) {
  return String(host || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

export function githubApiBase(host, type) {
  const hostname = normalizeHostname(host);
  if (!hostname) throw new Error("github.host es obligatorio.");
  if (hostname === "github.com") return "https://api.github.com";
  if (type === "ghes") return `https://${hostname}/api/v3`;
  return `https://api.${hostname}`;
}

export async function inspectGitHubCli(host) {
  const version = await runCommand("gh", ["--version"], { timeoutMs: 15000 });
  if (!version.ok) {
    return { installed: false, authenticated: false, error: version.error || "GitHub CLI no está instalado." };
  }
  const hostname = normalizeHostname(host);
  const auth = await runCommand("gh", ["auth", "status", "--hostname", hostname], { timeoutMs: 20000 });
  const output = `${auth.stdout}\n${auth.stderr}`;
  const login = /Logged in to [^ ]+ account ([^ ]+)/i.exec(output)?.[1]
    || /account ([A-Za-z0-9-]+) \(/i.exec(output)?.[1]
    || "";
  return {
    installed: true,
    version: version.stdout.split(/\r?\n/)[0],
    authenticated: auth.ok,
    host: hostname,
    login,
    authOutput: output.trim(),
  };
}

export async function getAuthStatus(host, { refresh = false } = {}) {
  if (!refresh && statusCache.value && Date.now() - statusCache.at < 10_000) return statusCache.value;
  const value = await inspectGitHubCli(host);
  statusCache = { at: Date.now(), value };
  return value;
}

export function invalidateAuthCache() {
  statusCache = { at: 0, value: null };
  tokenCache.clear();
}

export async function resolveGitHubToken(host) {
  const hostname = normalizeHostname(host);
  const cached = tokenCache.get(hostname);
  if (cached?.expiresAt > Date.now()) return cached.promise;
  const entry = {
    expiresAt: Date.now() + TOKEN_TTL_MS,
    promise: runCommand("gh", ["auth", "token", "--hostname", hostname], { timeoutMs: 15000 }).then((result) => {
      if (!result.ok || !result.stdout) {
        throw new Error(`No hay sesión activa de GitHub CLI para ${hostname}. Inicia sesión desde Doriath o ejecuta "gh auth login --hostname ${hostname}".`);
      }
      return result.stdout.trim();
    }),
  };
  tokenCache.set(hostname, entry);
  try {
    return await entry.promise;
  } catch (error) {
    if (tokenCache.get(hostname) === entry) tokenCache.delete(hostname);
    throw error;
  }
}

export async function getAuthenticatedUser(host) {
  const hostname = normalizeHostname(host);
  const result = await runCommand("gh", ["api", "user", "--hostname", hostname], { timeoutMs: 20000 });
  if (!result.ok) return null;
  try {
    const user = JSON.parse(result.stdout);
    return { login: user.login || "", name: user.name || "", email: user.email || "", avatarUrl: user.avatar_url || "" };
  } catch {
    return null;
  }
}

/**
 * Abre el login de gh en una consola propia (Windows) para que el usuario complete el flujo web con
 * su correo corporativo. El servidor no puede hacer el prompt interactivo él mismo.
 */
export async function startGitHubLogin(host) {
  const hostname = normalizeHostname(host);
  const loginArgs = ["auth", "login", "--hostname", hostname, "--web", "--git-protocol", "https"];
  const setupArgs = ["auth", "setup-git", "--hostname", hostname];
  invalidateAuthCache();

  if (process.platform === "win32") {
    const script = `gh ${loginArgs.join(" ")} && gh ${setupArgs.join(" ")} && echo. && echo Sesion iniciada. Puedes cerrar esta ventana y volver a Doriath. && timeout /t 8`;
    spawnDetached("cmd.exe", ["/c", "start", "Doriath - Inicio de sesion en GitHub", "cmd.exe", "/c", script]);
    return { started: true, mode: "console", message: "Se ha abierto una consola con el inicio de sesión de GitHub. Completa el flujo en el navegador con tu correo de BBVA." };
  }

  const command = `gh ${loginArgs.join(" ")} && gh ${setupArgs.join(" ")}`;
  if (process.platform === "darwin") {
    spawnDetached("osascript", ["-e", `tell application "Terminal" to do script "${command.replace(/"/g, '\\"')}"`]);
    return { started: true, mode: "terminal", message: "Se ha abierto Terminal con el inicio de sesión de GitHub." };
  }
  const terminals = [
    ["x-terminal-emulator", ["-e"]],
    ["gnome-terminal", ["--"]],
    ["konsole", ["-e"]],
    ["xterm", ["-e"]],
  ];
  for (const [terminal, prefix] of terminals) {
    const probe = await runCommand("which", [terminal], { timeoutMs: 5000 });
    if (probe.ok) {
      spawnDetached(terminal, [...prefix, "bash", "-lc", command]);
      return { started: true, mode: "terminal", message: `Se ha abierto ${terminal} con el inicio de sesión de GitHub.` };
    }
  }
  log.warn("auth", "No hay terminal disponible para lanzar gh auth login.");
  return {
    started: false,
    mode: "manual",
    message: `Ejecuta en una terminal: gh ${loginArgs.join(" ")} && gh ${setupArgs.join(" ")}`,
  };
}

export async function logoutGitHub(host) {
  const hostname = normalizeHostname(host);
  const result = await runCommand("gh", ["auth", "logout", "--hostname", hostname], { timeoutMs: 20000, input: "y\n" });
  invalidateAuthCache();
  return { ok: result.ok, output: result.stdout || result.stderr };
}
