import path from "node:path";
import { ensureDir } from "../util/fs.mjs";
import { paths } from "../paths.mjs";
import { log } from "../util/log.mjs";
import { resolveGitHubToken } from "../auth/gh.mjs";
import { createPermissionHandler, TOOL_PROFILES } from "./permissions.mjs";

/**
 * Adaptador del SDK oficial de GitHub Copilot (`@github/copilot-sdk`), heredado de FENIX:
 *  - sin BYOK: la identidad es la del usuario corporativo (token de `gh` o sesión del runtime);
 *  - se eliminan del entorno claves de otros proveedores para que el runtime no las use por error;
 *  - el catálogo de modelos es el real de la licencia (`client.listModels()`), no una lista fija.
 */
const PROVIDER_SECRET_VARIABLES = [
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_KEY",
  "GOOGLE_API_KEY", "GEMINI_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
];

let sdkPromise = null;
async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import("@github/copilot-sdk").catch((error) => {
      sdkPromise = null;
      throw new Error(`No se pudo cargar el SDK de GitHub Copilot. Ejecuta npm install. Detalle: ${error.message}`);
    });
  }
  return sdkPromise;
}

export function sanitizedCopilotEnvironment(config) {
  const env = { ...process.env };
  for (const key of PROVIDER_SECRET_VARIABLES) delete env[key];
  env.GH_HOST = config.copilot.host;
  delete env.COPILOT_HOME;
  return env;
}

// Modo de autenticación que ha funcionado en este proceso ("gh-token" | "logged-in-user").
let workingAuthMode = null;

async function authOptions(config, mode) {
  if (mode === "gh-token") {
    const token = await resolveGitHubToken(config.github.host);
    return { gitHubToken: token, useLoggedInUser: false };
  }
  return { useLoggedInUser: true };
}

export async function createCopilotClient(config, workingDirectory, { authMode } = {}) {
  const { CopilotClient } = await loadSdk();
  await ensureDir(paths.copilotHome);
  const mode = authMode || workingAuthMode || (config.copilot.auth === "auto" ? "gh-token" : config.copilot.auth);
  const client = new CopilotClient({
    workingDirectory,
    baseDirectory: paths.copilotHome,
    env: sanitizedCopilotEnvironment(config),
    logLevel: "warning",
    ...(await authOptions(config, mode)),
  });
  client.__doriathAuthMode = mode;
  return client;
}

/**
 * Arranca un cliente probando los modos de autenticación configurados. Devuelve el cliente ya
 * iniciado; el llamador es responsable de `client.stop()`.
 */
export async function startClient(config, workingDirectory) {
  const configured = config.copilot.auth || "auto";
  const modes = configured === "auto"
    ? (workingAuthMode ? [workingAuthMode, workingAuthMode === "gh-token" ? "logged-in-user" : "gh-token"] : ["gh-token", "logged-in-user"])
    : [configured];
  let lastError = null;
  for (const mode of modes) {
    let client;
    try {
      client = await createCopilotClient(config, workingDirectory, { authMode: mode });
      await client.start();
      const status = await client.getAuthStatus().catch(() => null);
      if (status && status.isAuthenticated === false) {
        throw new Error(status.statusMessage || `El runtime Copilot no reconoce la sesión (${mode}).`);
      }
      workingAuthMode = mode;
      return client;
    } catch (error) {
      lastError = error;
      log.warn("copilot", `Autenticación ${mode} fallida: ${error.message}`);
      await client?.stop().catch(() => []);
    }
  }
  const hint = `Comprueba la sesión de GitHub (gh auth status --hostname ${config.github.host}) o ejecuta "copilot login --host ${config.copilot.host}".`;
  throw new Error(`${lastError?.message || "No se pudo iniciar Copilot."} ${hint}`);
}

export async function withClient(config, workingDirectory, task) {
  const client = await startClient(config, workingDirectory);
  try {
    return await task(client);
  } finally {
    await client.stop().catch(() => []);
  }
}

/* ---------- Catálogo de modelos y cuota ---------- */

const COST_EFFICIENCY_BY_CATEGORY = { low: 5, medium: 3, high: 2, very_high: 1 };

export function normalizeCopilotQuota(quotaResult) {
  const snapshot = quotaResult?.quotaSnapshots?.premium_interactions;
  if (!snapshot) return null;
  const entitlement = Number(snapshot.entitlementRequests || 0);
  const used = Number(snapshot.usedRequests || 0);
  const unlimited = Boolean(snapshot.isUnlimitedEntitlement) || entitlement < 0;
  return {
    unlimited,
    entitlement: unlimited ? null : entitlement,
    used,
    remaining: unlimited ? null : Math.max(0, entitlement - used),
    remainingPercentage: Number(snapshot.remainingPercentage || 0),
    resetDate: snapshot.resetDate || null,
  };
}

let catalogCache = { at: 0, value: null };

export async function getModelCatalog(config, { refresh = false } = {}) {
  if (!refresh && catalogCache.value && Date.now() - catalogCache.at < 10 * 60 * 1000) return catalogCache.value;
  const value = await withClient(config, paths.dataRoot, async (client) => {
    const [models, quota, auth] = await Promise.all([
      client.listModels(),
      client.rpc?.account?.getQuota?.({}).catch(() => null) ?? null,
      client.getAuthStatus().catch(() => null),
    ]);
    return {
      authMode: client.__doriathAuthMode,
      auth: auth ? { login: auth.login || "", host: auth.host || "", authType: auth.authType || "" } : null,
      quota: normalizeCopilotQuota(quota),
      models: models.map((model) => ({
        id: model.id,
        name: model.name || model.id,
        priceCategory: String(model.modelPickerPriceCategory || model.billing?.multiplier || "").toString(),
        costEfficiencyScore: COST_EFFICIENCY_BY_CATEGORY[String(model.modelPickerPriceCategory || "").toLowerCase()] || 3,
        vision: Boolean(model.capabilities?.supports?.vision),
        supportsReasoningEffort: Boolean(model.capabilities?.supports?.reasoningEffort),
        supportedReasoningEfforts: model.supportedReasoningEfforts || [],
        maxPromptTokens: model.capabilities?.limits?.max_prompt_tokens,
        maxContextWindowTokens: model.capabilities?.limits?.max_context_window_tokens,
        maxOutputTokens: model.capabilities?.limits?.max_output_tokens,
        multiplier: model.billing?.multiplier,
      })),
    };
  });
  catalogCache = { at: Date.now(), value };
  return value;
}

export function invalidateModelCatalog() {
  catalogCache = { at: 0, value: null };
}

/** Elige el modelo efectivo: el configurado si existe en el catálogo, si no el primero "capaz" del catálogo. */
export function pickModel(catalog, requested) {
  const models = catalog?.models || [];
  const wanted = String(requested || "auto").trim();
  if (wanted && wanted !== "auto") {
    const found = models.find((model) => model.id === wanted);
    if (found) return found.id;
    throw new Error(`El modelo ${wanted} no está disponible para tu licencia de Copilot.`);
  }
  const preferred = [/claude-sonnet-4/i, /claude-opus/i, /gpt-5/i, /gpt-4\.1/i, /claude/i, /gpt/i];
  for (const pattern of preferred) {
    const found = models.find((model) => pattern.test(model.id));
    if (found) return found.id;
  }
  return models[0]?.id;
}

/* ---------- Herramientas propias ---------- */

export async function defineDoriathTool(name, { description, parameters, handler }) {
  const { defineTool } = await loadSdk();
  return defineTool(name, {
    description,
    parameters: parameters || { type: "object", properties: {} },
    handler: async (args, invocation) => {
      try {
        const result = await handler(args || {}, invocation);
        if (typeof result === "string") return result;
        return JSON.stringify(result ?? null, null, 2);
      } catch (error) {
        return `ERROR: ${error.message}`;
      }
    },
  });
}

/* ---------- Normalización de eventos para la UI ---------- */

export function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningOutputTokens: 0, premiumRequests: 0, models: new Set() };
}

export function addUsage(total, data = {}) {
  total.inputTokens += Number(data.inputTokens || 0);
  total.outputTokens += Number(data.outputTokens || 0);
  total.cacheReadTokens += Number(data.cacheReadTokens || 0);
  total.reasoningOutputTokens += Number(data.reasoningOutputTokens || 0);
  if (!data.initiator) total.premiumRequests += Number(data.cost || 0);
  if (data.model) total.models.add(data.model);
}

export function serializeUsage(usage) {
  return { ...usage, models: [...usage.models] };
}

function summarizeToolArguments(args = {}) {
  const target = args.path || args.filePath || args.file || args.pattern || args.query || args.command || args.id || args.spec_id;
  if (Array.isArray(target)) return target.join(", ");
  return target ? String(target).slice(0, 200) : "";
}

/**
 * Registra un listener sobre la sesión que:
 *  - reconstruye el mensaje final aunque el runtime lo parta en continuaciones automáticas;
 *  - acumula consumo;
 *  - reenvía eventos compactos a `onEvent` (deltas, herramientas, errores).
 */
export function attachSessionListener(session, { onEvent, usage }) {
  let accumulated = "";
  let continuation = false;
  const tools = new Map();
  session.on((event) => {
    const type = event?.type;
    const data = event?.data || {};
    if (type === "assistant.message_delta") {
      onEvent?.({ type: "delta", text: String(data.deltaContent || "") });
    } else if (type === "assistant.reasoning_delta") {
      onEvent?.({ type: "reasoning", text: String(data.deltaContent || "") });
    } else if (type === "assistant.message") {
      if (!(data.toolRequests || []).length) {
        const content = String(data.content || "");
        accumulated = continuation ? accumulated + content : content;
        continuation = false;
        onEvent?.({ type: "message", content: accumulated });
      }
    } else if (type === "user.message" && data.source === "thinking-exhausted-continuation") {
      continuation = true;
    } else if (type === "assistant.usage") {
      addUsage(usage, data);
    } else if (type === "tool.execution_start") {
      tools.set(data.toolCallId, { name: data.toolName, at: Date.now() });
      onEvent?.({ type: "tool", name: String(data.toolName || ""), target: summarizeToolArguments(data.arguments), id: data.toolCallId });
    } else if (type === "tool.execution_complete") {
      const started = tools.get(data.toolCallId);
      tools.delete(data.toolCallId);
      onEvent?.({ type: "tool_done", name: started?.name || "", success: data.success !== false, id: data.toolCallId, error: data.error ? String(data.error).slice(0, 300) : "" });
    } else if (type === "session.error") {
      onEvent?.({ type: "error", message: String(data.message || "Error en la sesión Copilot") });
    } else if (type === "assistant.turn_start") {
      onEvent?.({ type: "turn_start" });
    } else if (type === "assistant.turn_end") {
      onEvent?.({ type: "turn_end" });
    }
  });
  return { get content() { return accumulated; } };
}

function buildSessionConfig({ config, model, reasoningEffort, systemMessage, tools, availableTools, permissionProfile, workspaceRoots, allowNetwork }) {
  const profileTools = TOOL_PROFILES[permissionProfile] || [];
  const customNames = (tools || []).map((tool) => tool.name);
  const available = availableTools || [...new Set([...profileTools, ...customNames])];
  const session = {
    streaming: true,
    clientName: "doriath",
    model,
    availableTools: available,
    tools: tools || [],
    onPermissionRequest: createPermissionHandler(permissionProfile, { workspaceRoots, allowNetwork }),
    systemMessage: { mode: "append", content: systemMessage || "" },
  };
  const effort = String(reasoningEffort || config.copilot.reasoningEffort || "auto");
  if (effort !== "auto") session.reasoningEffort = effort;
  return session;
}

/**
 * Ejecuta una consulta de un solo turno (análisis de documentos, generación de specs, implementación
 * de una tarea). Crea cliente y sesión, envía el prompt, espera la respuesta y cierra todo.
 */
export async function runOneShot({
  config,
  workingDirectory,
  systemMessage,
  prompt,
  attachments,
  tools = [],
  availableTools,
  permissionProfile = "readonly",
  workspaceRoots = [],
  allowNetwork = false,
  model,
  reasoningEffort,
  onEvent,
  timeoutMs,
  cancellationToken,
  requireContent = true,
}) {
  cancellationToken?.throwIfCancelled();
  const client = await startClient(config, workingDirectory);
  const usage = emptyUsage();
  let session;
  let unregister;
  try {
    const catalog = await getModelCatalog(config);
    const effectiveModel = pickModel(catalog, model || config.copilot.model);
    session = await client.createSession(buildSessionConfig({
      config, model: effectiveModel, reasoningEffort, systemMessage, tools, availableTools, permissionProfile, workspaceRoots, allowNetwork,
    }));
    unregister = cancellationToken?.registerAbort(() => session.abort().catch(() => undefined));
    const listener = attachSessionListener(session, { onEvent, usage });
    const timeout = timeoutMs || config.copilot.timeoutMs;
    let result = await session.sendAndWait({ prompt, attachments }, timeout);
    cancellationToken?.throwIfCancelled();
    let content = listener.content || String(result?.data?.content || "");
    if (requireContent && !content.trim()) {
      result = await session.sendAndWait({ prompt: "No has devuelto contenido. No uses más herramientas: emite ahora la respuesta final completa en el formato solicitado." }, timeout);
      content = listener.content || String(result?.data?.content || "");
      if (!content.trim()) {
        const error = new Error("La sesión Copilot terminó sin producir contenido.");
        error.code = "COPILOT_EMPTY_RESPONSE";
        throw error;
      }
    }
    return { content, model: effectiveModel, sessionId: session.sessionId, usage: serializeUsage(usage) };
  } finally {
    unregister?.();
    await session?.disconnect().catch(() => undefined);
    await client.stop().catch(() => []);
  }
}

/* ---------- Sesiones persistentes (chats) ---------- */

const IDLE_TTL_MS = 20 * 60 * 1000;
const MAX_LIVE_SESSIONS = 4;

/**
 * Mantiene viva una sesión Copilot por conversación para que el runtime conserve el contexto entre
 * turnos. Si la sesión ha caducado (reinicio, inactividad), el llamador reconstruye el contexto con
 * el historial guardado (`bootstrapPrompt`).
 */
export class SessionPool {
  constructor() {
    this.entries = new Map();
    this.timer = setInterval(() => this.evictIdle(), 60 * 1000);
    this.timer.unref?.();
  }

  has(key) {
    return this.entries.has(key);
  }

  async acquire(key, { config, workingDirectory, systemMessage, tools, availableTools, permissionProfile, workspaceRoots, allowNetwork, model, reasoningEffort }) {
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return { entry: existing, fresh: false };
    }
    if (this.entries.size >= MAX_LIVE_SESSIONS) this.evictOldest();
    const client = await startClient(config, workingDirectory);
    try {
      const catalog = await getModelCatalog(config);
      const effectiveModel = pickModel(catalog, model || config.copilot.model);
      const usage = emptyUsage();
      const session = await client.createSession(buildSessionConfig({
        config, model: effectiveModel, reasoningEffort, systemMessage, tools, availableTools, permissionProfile, workspaceRoots, allowNetwork,
      }));
      const entry = { key, client, session, usage, model: effectiveModel, lastUsed: Date.now(), busy: false, listeners: new Set(), content: "" };
      const listener = attachSessionListener(session, {
        usage,
        onEvent: (event) => {
          if (event.type === "message") entry.content = event.content;
          for (const fn of entry.listeners) fn(event);
        },
      });
      entry.listener = listener;
      this.entries.set(key, entry);
      return { entry, fresh: true };
    } catch (error) {
      await client.stop().catch(() => []);
      throw error;
    }
  }

  async send(key, { prompt, attachments, onEvent, timeoutMs }) {
    const entry = this.entries.get(key);
    if (!entry) throw new Error("La sesión no está activa.");
    if (entry.busy) throw new Error("La conversación ya está procesando un mensaje.");
    entry.busy = true;
    entry.content = "";
    if (onEvent) entry.listeners.add(onEvent);
    try {
      const result = await entry.session.sendAndWait({ prompt, attachments }, timeoutMs);
      entry.lastUsed = Date.now();
      const content = entry.listener.content || String(result?.data?.content || "");
      return { content, model: entry.model, usage: serializeUsage(entry.usage) };
    } finally {
      entry.busy = false;
      if (onEvent) entry.listeners.delete(onEvent);
    }
  }

  async abort(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    await entry.session.abort().catch(() => undefined);
    return true;
  }

  async release(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    await entry.session.disconnect().catch(() => undefined);
    await entry.client.stop().catch(() => []);
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

export const sessionPool = new SessionPool();

/** Diagnóstico rápido para la pantalla de estado. */
export async function copilotStatus(config) {
  try {
    const catalog = await getModelCatalog(config);
    return { available: true, authMode: catalog.authMode, auth: catalog.auth, models: catalog.models.length, quota: catalog.quota, error: "" };
  } catch (error) {
    return { available: false, authMode: workingAuthMode, auth: null, models: 0, quota: null, error: error.message };
  }
}

/**
 * Sesión efímera multi-turno: útil cuando una fase necesita pedir "continúa" al modelo si la salida
 * se corta por límite de tokens. `task` recibe `send(prompt)` y la sesión se cierra al terminar.
 */
export async function withSession({
  config,
  workingDirectory,
  systemMessage,
  tools = [],
  availableTools,
  permissionProfile = "none",
  workspaceRoots = [],
  allowNetwork = false,
  model,
  reasoningEffort,
  onEvent,
  timeoutMs,
  cancellationToken,
}, task) {
  cancellationToken?.throwIfCancelled();
  const client = await startClient(config, workingDirectory);
  const usage = emptyUsage();
  let session;
  let unregister;
  try {
    const catalog = await getModelCatalog(config);
    const effectiveModel = pickModel(catalog, model || config.copilot.model);
    session = await client.createSession(buildSessionConfig({
      config, model: effectiveModel, reasoningEffort, systemMessage, tools, availableTools, permissionProfile, workspaceRoots, allowNetwork,
    }));
    unregister = cancellationToken?.registerAbort(() => session.abort().catch(() => undefined));
    const listener = attachSessionListener(session, { onEvent, usage });
    const timeout = timeoutMs || config.copilot.timeoutMs;
    const send = async (prompt, attachments) => {
      cancellationToken?.throwIfCancelled();
      const result = await session.sendAndWait({ prompt, attachments }, timeout);
      cancellationToken?.throwIfCancelled();
      return listener.content || String(result?.data?.content || "");
    };
    const output = await task({ send, model: effectiveModel, sessionId: session.sessionId });
    return { output, model: effectiveModel, usage: serializeUsage(usage) };
  } finally {
    unregister?.();
    await session?.disconnect().catch(() => undefined);
    await client.stop().catch(() => []);
  }
}
