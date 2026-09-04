import process from "node:process";
import path from "node:path";
import { existsSync } from "node:fs";
import { runCommand, spawnDetached } from "../util/process.mjs";
import { paths } from "../paths.mjs";
import { log } from "../util/log.mjs";

/**
 * Sesión GitHub tomada de la CLI `gh`, igual que FENIX: KDD Studio nunca guarda contraseñas ni tokens
 * propios; pide el token a `gh auth token` cuando lo necesita y lo cachea unos segundos en memoria.
 */
const TOKEN_TTL_MS = 30_000;
const tokenCache = new Map();
const statusCache = new Map();

/**
 * Localiza `gh`. Normalmente basta con el PATH, pero el servidor lo hereda del proceso que lo lanzó:
 * si el usuario instala la CLI (o la añade al PATH de usuario) con KDD Studio ya abierto, ese PATH se
 * queda antiguo y `gh` deja de encontrarse. Se prueban también la copia portable de KDD Studio y las
 * rutas de instalación habituales en Windows, incluida la que usa FENIX.
 */
let ghPath = "";
async function ghCommand() {
  if (ghPath && (ghPath === "gh" || existsSync(ghPath))) return ghPath;
  const probe = await runCommand("gh", ["--version"], { timeoutMs: 15000 });
  if (probe.ok) {
    ghPath = "gh";
    return ghPath;
  }
  if (process.platform === "win32") {
    const candidates = [
      paths.runtimeDir ? path.join(paths.runtimeDir, "gh", "bin", "gh.exe") : "",
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "GitHubCLI", "bin", "gh.exe") : "",
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "GitHub CLI", "bin", "gh.exe") : "",
      process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "GitHub CLI", "bin", "gh.exe") : "",
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      log.info("auth", `GitHub CLI encontrada fuera del PATH: ${candidate}`);
      ghPath = candidate;
      return ghPath;
    }
  }
  ghPath = "";
  return "gh";
}

/** Ejecuta gh resolviendo antes dónde está. */
async function gh(args, options = {}) {
  return runCommand(await ghCommand(), args, { timeoutMs: 20000, ...options });
}

function parseLogin(output) {
  return /Logged in to \S+ account (\S+)/i.exec(output)?.[1]
    || /Logged in to \S+ as (\S+)/i.exec(output)?.[1]
    || /account ([A-Za-z0-9-]+) \(/i.exec(output)?.[1]
    || "";
}

/** Hosts con sesión, para poder avisar de "tienes sesión, pero en otro host". */
async function authenticatedHosts() {
  const all = await gh(["auth", "status"]);
  const output = `${all.stdout}\n${all.stderr}`;
  const hosts = new Set();
  for (const match of output.matchAll(/Logged in to (\S+?)[\s:]/gi)) hosts.add(match[1].toLowerCase());
  for (const match of output.matchAll(/^([A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*$/gm)) hosts.add(match[1].toLowerCase());
  return [...hosts];
}

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
  const version = await gh(["--version"], { timeoutMs: 15000 });
  if (!version.ok) {
    return { installed: false, authenticated: false, error: version.error || "GitHub CLI no está instalado.", authOutput: "", warning: "", otherHosts: [], executable: await ghCommand() };
  }
  const hostname = normalizeHostname(host);
  const auth = await gh(["auth", "status", "--hostname", hostname]);
  const output = `${auth.stdout}\n${auth.stderr}`.trim();
  let authenticated = auth.ok;
  let warning = "";

  // `gh auth status` valida el token contra la API. En la red corporativa esa llamada puede fallar
  // (proxy, certificados, SSO caducado) aunque la sesión exista y sea utilizable, y entonces gh
  // devuelve un código distinto de cero. Lo que KDD Studio necesita de verdad es el token, así que se
  // pregunta directamente: si gh lo entrega, hay sesión.
  if (!authenticated) {
    const token = await gh(["auth", "token", "--hostname", hostname], { timeoutMs: 15000 });
    if (token.ok && token.stdout.trim()) {
      authenticated = true;
      warning = `Hay una sesión de gh para ${hostname}, pero "gh auth status" no ha podido validarla (proxy, certificados o SSO). KDD Studio usa el token igualmente; si Copilot falla, revisa la salida de gh.`;
      log.warn("auth", `gh auth status falló para ${hostname} pero hay token disponible.`);
    }
  }

  // Sin sesión en el host configurado: mirar si la hay en otro (confusión típica entre
  // github.com y el GitHub Enterprise corporativo).
  let otherHosts = [];
  if (!authenticated) {
    otherHosts = (await authenticatedHosts()).filter((item) => item !== hostname);
  }

  return {
    installed: true,
    version: version.stdout.split(/\r?\n/)[0],
    authenticated,
    host: hostname,
    login: parseLogin(output),
    warning,
    otherHosts,
    authOutput: output,
    executable: await ghCommand(),
  };
}

export async function getAuthStatus(host, { refresh = false } = {}) {
  const key = normalizeHostname(host);
  const cached = statusCache.get(key);
  if (!refresh && cached && Date.now() - cached.at < 10_000) return cached.value;
  const value = await inspectGitHubCli(host);
  statusCache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateAuthCache() {
  statusCache.clear();
  tokenCache.clear();
  actorCache = { at: 0, host: "", name: "" };
  ghPath = "";
}

export async function resolveGitHubToken(host) {
  const hostname = normalizeHostname(host);
  const cached = tokenCache.get(hostname);
  if (cached?.expiresAt > Date.now()) return cached.promise;
  const entry = {
    expiresAt: Date.now() + TOKEN_TTL_MS,
    promise: gh(["auth", "token", "--hostname", hostname], { timeoutMs: 15000 }).then((result) => {
      if (!result.ok || !result.stdout) {
        throw new Error(`No hay sesión activa de GitHub CLI para ${hostname}. Inicia sesión desde KDD Studio o ejecuta "gh auth login --hostname ${hostname}".`);
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

/**
 * Nombre con el que firmar los cambios en el registro de la base de conocimiento: el de la sesión de
 * GitHub. Se cachea un minuto porque cada consulta lanza `gh api user`.
 */
let actorCache = { at: 0, host: "", name: "" };
export async function currentActor(host) {
  const hostname = normalizeHostname(host);
  if (actorCache.host === hostname && Date.now() - actorCache.at < 60_000 && actorCache.name) return actorCache.name;
  const user = await getAuthenticatedUser(hostname).catch(() => null);
  const name = user?.name || user?.login || "usuario local";
  actorCache = { at: Date.now(), host: hostname, name };
  return name;
}

export async function getAuthenticatedUser(host) {
  const hostname = normalizeHostname(host);
  const result = await gh(["api", "user", "--hostname", hostname]);
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
  // Se resuelve gh antes de vaciar la caché: la consola que se abre debe usar el mismo ejecutable
  // que encontró KDD Studio, no confiar en que esté en el PATH de esa consola.
  const executable = await ghCommand();
  const quoted = /\s/.test(executable) ? `"${executable}"` : executable;
  invalidateAuthCache();

  if (process.platform === "win32") {
    const script = `${quoted} ${loginArgs.join(" ")} && ${quoted} ${setupArgs.join(" ")} && echo. && echo Sesion iniciada. Puedes cerrar esta ventana y volver a KDD Studio. && timeout /t 8`;
    spawnDetached("cmd.exe", ["/c", "start", "KDD Studio - Inicio de sesion en GitHub", "cmd.exe", "/c", script]);
    return { started: true, mode: "console", message: "Se ha abierto una consola con el inicio de sesión de GitHub. Completa el flujo en el navegador con tu correo de BBVA." };
  }

  const command = `${quoted} ${loginArgs.join(" ")} && ${quoted} ${setupArgs.join(" ")}`;
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
    message: `Ejecuta en una terminal: ${command}`,
  };
}

export async function logoutGitHub(host) {
  const hostname = normalizeHostname(host);
  const result = await gh(["auth", "logout", "--hostname", hostname], { input: "y\n" });
  invalidateAuthCache();
  return { ok: result.ok, output: result.stdout || result.stderr };
}
