import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getConfig } from "../config.mjs";
import { paths } from "../paths.mjs";
import { log } from "../util/log.mjs";
import { codexCommand } from "../auth/codex.mjs";
import { registerToolSet, unregisterToolSet } from "./mcp-bridge.mjs";

/**
 * Adaptador de Codex, el motor de KDD Assistant.
 *
 * La diferencia con Copilot no es de API sino de forma:
 *
 *  - **La sesión no es del programa, es de la persona.** `codex login` deja la credencial en
 *    `~/.codex`; aquí no se guarda ni se pide nada. El cupo que se gasta es el del plan de ChatGPT.
 *  - **No hay mensaje de sistema.** Un hilo de Codex empieza con la primera entrada del usuario, así
 *    que las instrucciones viajan dentro de ese primer turno y no se repiten.
 *  - **No hay herramientas en proceso.** Llegan por MCP, y un servidor MCP es otro proceso. Por eso
 *    el hilo se configura con un servidor que apunta al puente HTTP de esta misma aplicación.
 *
 * Hacia fuera el pool tiene la misma superficie que el de Copilot (`acquire`, `send`, `abort`,
 * `release`, `shutdown`), de modo que `chats.mjs` no sabe con cuál de los dos está hablando.
 */
const IDLE_TTL_MS = 30 * 60 * 1000;
const MAX_LIVE_SESSIONS = 8;
const MCP_SERVER_NAME = "kdd";

let sdkPromise = null;
async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import("@openai/codex-sdk").catch((error) => {
      sdkPromise = null;
      throw new Error(`No se pudo cargar el SDK de Codex. Ejecuta npm install. Detalle: ${error.message}`);
    });
  }
  return sdkPromise;
}

/** El script del servidor MCP, que Codex lanza como proceso hijo. */
function mcpServerScript() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "mcp", "kdd-mcp-server.mjs");
}

/** La URL del propio servidor: el proceso MCP vuelve por aquí a buscar las herramientas. */
function localBaseUrl() {
  const { server } = getConfig();
  return `http://${server.host}:${server.port}`;
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningOutputTokens: 0, premiumRequests: 0, models: new Set() };
}

function addUsage(total, usage, model) {
  if (!usage) return;
  total.inputTokens += Number(usage.input_tokens || 0);
  total.outputTokens += Number(usage.output_tokens || 0);
  total.cacheReadTokens += Number(usage.cached_input_tokens || 0);
  total.reasoningOutputTokens += Number(usage.reasoning_output_tokens || 0);
  // Con ChatGPT no hay "peticiones premium": lo que se cuenta son turnos de la ventana de 5 horas.
  total.premiumRequests += 1;
  if (model) total.models.add(model);
}

function serializeUsage(usage) {
  return { ...usage, models: [...usage.models] };
}

/** Resumen corto de los argumentos de una herramienta, para la línea que ve el usuario. */
function summarizeArguments(args) {
  const value = typeof args === "string" ? safeParse(args) : args;
  if (!value || typeof value !== "object") return "";
  for (const key of ["id", "specId", "query", "name", "path", "document", "term"]) {
    if (value[key]) return String(value[key]).slice(0, 80);
  }
  const first = Object.values(value).find((item) => typeof item === "string" && item);
  return first ? String(first).slice(0, 80) : "";
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Traduce los eventos de un turno de Codex a los que ya entiende la interfaz (`delta`, `tool`,
 * `tool_done`, `message`, `error`). Codex no emite el texto carácter a carácter: manda el mensaje
 * del agente cuando está hecho, así que el "delta" es el mensaje entero de una vez.
 */
async function consumeEvents(events, { onEvent, usage, model }) {
  let content = "";
  let failure = "";
  const open = new Map();
  for await (const event of events) {
    if (event.type === "turn.started") {
      onEvent?.({ type: "turn_start" });
    } else if (event.type === "turn.completed") {
      addUsage(usage, event.usage, model);
      onEvent?.({ type: "turn_end" });
    } else if (event.type === "turn.failed") {
      failure = String(event.error?.message || "El turno de Codex ha fallado.");
    } else if (event.type === "error") {
      failure = String(event.message || "Error en la sesión de Codex.");
    } else if (event.type === "item.started" && event.item?.type === "mcp_tool_call") {
      open.set(event.item.id, event.item.tool);
      onEvent?.({ type: "tool", name: String(event.item.tool || ""), target: summarizeArguments(event.item.arguments), id: event.item.id });
    } else if (event.type === "item.completed") {
      const item = event.item || {};
      if (item.type === "mcp_tool_call") {
        const name = open.get(item.id) || item.tool || "";
        open.delete(item.id);
        onEvent?.({ type: "tool_done", name, success: item.status !== "failed", id: item.id, error: item.error?.message ? String(item.error.message).slice(0, 300) : "" });
      } else if (item.type === "agent_message") {
        content = String(item.text || "");
        onEvent?.({ type: "delta", text: content });
        onEvent?.({ type: "message", content });
      } else if (item.type === "reasoning" && item.text) {
        onEvent?.({ type: "reasoning", text: String(item.text) });
      } else if (item.type === "error" && item.message) {
        failure = String(item.message);
      }
    }
  }
  if (failure && !content) throw new Error(failure);
  if (failure) onEvent?.({ type: "error", message: failure });
  return content;
}

export class CodexSessionPool {
  constructor() {
    this.entries = new Map();
    this.timer = setInterval(() => this.evictIdle(), 60 * 1000);
    this.timer.unref?.();
  }

  has(key) {
    return this.entries.has(key);
  }

  /**
   * Prepara el hilo. No habla con el modelo todavía: Codex crea el hilo de verdad en el primer
   * turno, así que aquí solo se publica el juego de herramientas y se deja el hilo listo.
   */
  async acquire(key, { systemMessage, tools, workingDirectory, model, reasoningEffort } = {}) {
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      // Las herramientas se vuelven a registrar: el contexto de la conversación puede haber
      // cambiado (otra base, otro repositorio) aunque el hilo siga siendo el mismo.
      registerToolSet(key, tools || []);
      return { entry: existing, fresh: false };
    }
    if (this.entries.size >= MAX_LIVE_SESSIONS) this.evictOldest();

    const { Codex } = await loadSdk();
    const { token } = registerToolSet(key, tools || []);
    const config = getConfig();
    const codexPath = await codexCommand();
    const client = new Codex({
      // El binario que viaja con el instalador; si no hubiera, el de la CLI del sistema.
      codexPathOverride: codexPath && codexPath !== "codex" ? codexPath : undefined,
      config: {
        mcp_servers: {
          [MCP_SERVER_NAME]: {
            command: process.execPath,
            args: [mcpServerScript()],
            env: {
              KDD_MCP_URL: localBaseUrl(),
              KDD_MCP_KEY: key,
              KDD_MCP_TOKEN: token,
            },
          },
        },
      },
    });
    const thread = client.startThread({
      model: model && model !== "auto" ? model : undefined,
      modelReasoningEffort: reasoningEffort && reasoningEffort !== "auto" ? reasoningEffort : undefined,
      workingDirectory: workingDirectory || paths.dataRoot,
      // El asistente consulta y redacta; no toca el repositorio ni sale a la red por su cuenta.
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      // Las bases de conocimiento son carpetas normales, casi nunca repositorios de git.
      skipGitRepoCheck: true,
    });
    const entry = {
      key,
      client,
      thread,
      token,
      systemMessage: systemMessage || "",
      usage: emptyUsage(),
      model: model && model !== "auto" ? model : "codex",
      lastUsed: Date.now(),
      busy: false,
      controller: null,
      timeoutMs: config.copilot.timeoutMs,
    };
    this.entries.set(key, entry);
    return { entry, fresh: true };
  }

  async send(key, { prompt, attachments, onEvent, timeoutMs } = {}) {
    const entry = this.entries.get(key);
    if (!entry) throw new Error("La sesión no está activa.");
    if (entry.busy) throw new Error("La conversación ya está procesando un mensaje.");
    entry.busy = true;
    const controller = new AbortController();
    entry.controller = controller;
    // Codex no tiene mensaje de sistema: las instrucciones van en el primer turno del hilo.
    const first = !entry.started;
    const text = first && entry.systemMessage ? `${entry.systemMessage}\n\n---\n\n${prompt}` : prompt;
    const input = [{ type: "text", text }];
    // Las imágenes adjuntas se pasan por ruta; los documentos ya vienen dentro del prompt.
    for (const item of attachments || []) {
      if (item?.path) input.push({ type: "local_image", path: item.path });
    }
    const limit = Number(timeoutMs || entry.timeoutMs) || 600000;
    const guard = setTimeout(() => controller.abort(), limit);
    try {
      const { events } = await entry.thread.runStreamed(input, { signal: controller.signal });
      entry.started = true;
      const content = await consumeEvents(events, { onEvent, usage: entry.usage, model: entry.model });
      entry.lastUsed = Date.now();
      return { content, model: entry.model, usage: serializeUsage(entry.usage) };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("La respuesta se ha cancelado.");
      throw error;
    } finally {
      clearTimeout(guard);
      entry.controller = null;
      entry.busy = false;
    }
  }

  async abort(key) {
    const entry = this.entries.get(key);
    if (!entry?.controller) return false;
    entry.controller.abort();
    return true;
  }

  async release(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.controller?.abort();
    unregisterToolSet(key);
  }

  evictIdle() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (!entry.busy && now - entry.lastUsed > IDLE_TTL_MS) this.release(key).catch(() => undefined);
    }
  }

  evictOldest() {
    let oldest = null;
    for (const entry of this.entries.values()) {
      if (entry.busy) continue;
      if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
    }
    if (oldest) this.release(oldest.key).catch(() => undefined);
  }

  async shutdown() {
    clearInterval(this.timer);
    await Promise.all([...this.entries.keys()].map((key) => this.release(key)));
  }
}

export const codexSessionPool = new CodexSessionPool();

/** Diagnóstico para la pantalla de estado, con la misma forma que el de Copilot. */
export async function codexModelStatus() {
  try {
    await loadSdk();
    return { available: true, models: 0, error: "" };
  } catch (error) {
    log.warn("codex", error.message);
    return { available: false, models: 0, error: error.message };
  }
}
