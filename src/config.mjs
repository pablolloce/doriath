import { readJson, writeJson } from "./util/fs.mjs";
import { paths, defaultOutputsRoot, defaultKnowledgeBasesRoot } from "./paths.mjs";
import { edition } from "./edition.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  // El nombre lo pone la edición: el mismo código se llama KDD Studio o KDD Assistant según cuál
  // se haya construido. La versión es común.
  product: { name: edition.name, version: "0.1.0" },
  server: { host: "127.0.0.1", port: 4410 },
  github: { host: "bbva.ghe.com", type: "ghec" },
  copilot: {
    host: "bbva.ghe.com",
    // "gh-token": pasa al runtime el token de la sesión de gh (un solo login).
    // "logged-in-user": el runtime usa su propia sesión (`copilot login --host ...`).
    // "auto": prueba gh-token y, si falla, logged-in-user.
    auth: "auto",
    model: "auto",
    reasoningEffort: "auto",
    timeoutMs: 600000,
  },
  ui: { language: "es", openBrowser: true, browser: "chrome" },
  // Proxy de salida para gh, git y el runtime Copilot. Vacío = sin proxy. FENIX usa por defecto el
  // proxy local corporativo de Ivanti (http://127.0.0.1:8999); actívalo aquí si tu red lo exige.
  network: { proxyUrl: "", noProxy: "127.0.0.1,localhost" },
  paths: { outputs: defaultOutputsRoot, knowledgeBases: defaultKnowledgeBasesRoot },
  work: { commitAuthor: "", branchPrefix: "feature/kdd" },
});

function merge(base, extra) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object"
      ? merge(base[key], value)
      : value;
  }
  return out;
}

let cached = null;

export async function loadConfig() {
  const stored = await readJson(paths.configFile, {});
  cached = merge(structuredClone(DEFAULT_CONFIG), stored);
  if (process.env.KDD_PORT) cached.server.port = Number(process.env.KDD_PORT);
  if (process.env.KDD_PROXY) cached.network.proxyUrl = process.env.KDD_PROXY;
  if (process.env.KDD_GITHUB_HOST) {
    cached.github.host = process.env.KDD_GITHUB_HOST;
    cached.copilot.host = process.env.KDD_GITHUB_HOST;
  }
  return cached;
}

export function getConfig() {
  if (!cached) throw new Error("La configuración no se ha cargado todavía.");
  return cached;
}

const EDITABLE_SECTIONS = ["github", "copilot", "ui", "paths", "work", "server", "network"];

export async function updateConfig(patch) {
  const current = getConfig();
  const next = structuredClone(current);
  for (const section of EDITABLE_SECTIONS) {
    if (patch?.[section] && typeof patch[section] === "object") next[section] = merge(next[section], patch[section]);
  }
  if (next.github.host && !patch?.copilot?.host) next.copilot.host = next.github.host;
  cached = next;
  const { product, ...persisted } = next;
  await writeJson(paths.configFile, persisted);
  return cached;
}

/**
 * Aplica el proxy configurado al entorno del proceso (lo heredan gh, git y el runtime Copilot).
 * Devuelve true si se ha aplicado.
 */
export function applyNetworkEnvironment(config = getConfig()) {
  const proxy = String(config.network?.proxyUrl || "").trim();
  if (!proxy) return false;
  for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) process.env[key] = proxy;
  const noProxy = String(config.network?.noProxy || "127.0.0.1,localhost");
  process.env.NO_PROXY = noProxy;
  process.env.no_proxy = noProxy;
  return true;
}

/** Vista sin secretos para la UI. */
export function publicConfig(config = getConfig()) {
  return structuredClone(config);
}
