import { readJson, writeJson } from "./util/fs.mjs";
import { paths, defaultOutputsRoot, defaultKnowledgeBasesRoot } from "./paths.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  product: { name: "Doriath", version: "0.1.0" },
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
  paths: { outputs: defaultOutputsRoot, knowledgeBases: defaultKnowledgeBasesRoot },
  work: { commitAuthor: "", branchPrefix: "feature/doriath" },
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
  if (process.env.DORIATH_PORT) cached.server.port = Number(process.env.DORIATH_PORT);
  if (process.env.DORIATH_GITHUB_HOST) {
    cached.github.host = process.env.DORIATH_GITHUB_HOST;
    cached.copilot.host = process.env.DORIATH_GITHUB_HOST;
  }
  return cached;
}

export function getConfig() {
  if (!cached) throw new Error("La configuración no se ha cargado todavía.");
  return cached;
}

const EDITABLE_SECTIONS = ["github", "copilot", "ui", "paths", "work", "server"];

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

/** Vista sin secretos para la UI. */
export function publicConfig(config = getConfig()) {
  return structuredClone(config);
}
