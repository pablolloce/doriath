import { edition } from "../edition.mjs";

/**
 * De qué motor tira cada edición.
 *
 * KDD Studio habla con Copilot contra GitHub Enterprise; KDD Assistant, con Codex contra ChatGPT.
 * Los dos pools tienen la misma superficie, así que quien los usa —`chats.mjs`— no distingue: pide
 * `sessionPool` y ya está.
 *
 * La importación es diferida a propósito. Cada motor arrastra su SDK, y el instalador de cada
 * edición solo trae el suyo: cargar los dos por si acaso rompería la edición que no lo lleva.
 */
const pools = new Map();

async function loadPool() {
  if (edition.provider === "codex") {
    const { codexSessionPool } = await import("./codex.mjs");
    return codexSessionPool;
  }
  const { sessionPool: copilotPool } = await import("./copilot.mjs");
  return copilotPool;
}

function pool() {
  if (!pools.has("default")) pools.set("default", loadPool());
  return pools.get("default");
}

/** Fachada con la superficie del pool: cada llamada espera al motor de esta edición. */
export const sessionPool = {
  async has(key) {
    return (await pool()).has(key);
  },
  async acquire(key, options) {
    return (await pool()).acquire(key, options);
  },
  async send(key, options) {
    return (await pool()).send(key, options);
  },
  async abort(key) {
    return (await pool()).abort(key);
  },
  async release(key) {
    return (await pool()).release(key);
  },
  async shutdown() {
    if (!pools.has("default")) return;
    return (await pool()).shutdown();
  },
};

export const providerId = edition.provider;
