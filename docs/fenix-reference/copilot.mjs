import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createDatabaseTools } from "../database/tools.mjs";
import { evidenceCoverage } from "../evidence-coverage.mjs";
import { buildOutputLanguageDirective } from "../i18n.mjs";
import { performanceMonitor } from "../performance-monitor.mjs";
import { createPermissionHandler } from "../security/permission-policy.mjs";
import { createCopilotLoopGuard } from "./copilot-loop-guard.mjs";

const PROVIDER_SECRET_VARIABLES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];

export function sanitizedCopilotEnvironment(config) {
  const env = { ...process.env };
  for (const key of PROVIDER_SECRET_VARIABLES) {
    delete env[key];
  }

  env.GH_HOST = config.copilot.host;
  delete env.COPILOT_HOME;
  return env;
}

async function loadSdk() {
  try {
    return await import("@github/copilot-sdk");
  } catch (error) {
    throw new Error(
      `GitHub Copilot SDK is not installed or could not be loaded. Run npm install. Original error: ${error.message}`,
    );
  }
}

function telemetryOptions(config) {
  if (!config.telemetry?.enabled) return undefined;
  return {
    exporterType: "file",
    filePath: path.join(config.storage.directory, "telemetry", "copilot-otel.jsonl"),
    captureContent: Boolean(config.copilot.captureContentInTelemetry),
    sourceName: "fenix",
  };
}

export async function createCopilotClient(config, workingDirectory) {
  const { CopilotClient } = await loadSdk();
  await mkdir(path.join(config.storage.directory, "copilot-home"), { recursive: true });
  await mkdir(path.join(config.storage.directory, "telemetry"), { recursive: true });

  return new CopilotClient({
    workingDirectory,
    baseDirectory: path.join(config.storage.directory, "copilot-home"),
    useLoggedInUser: true,
    env: sanitizedCopilotEnvironment(config),
    telemetry: telemetryOptions(config),
    logLevel: "warning",
  });
}

export function buildModelContextTiers(model) {
  const limits = model?.capabilities?.limits || {};
  const maxContextWindowTokens = Number(limits.max_context_window_tokens || 0);
  if (!maxContextWindowTokens) return [];

  const maxOutputTokens = Number(limits.max_output_tokens || 0);
  const tokenPrices = model?.billing?.tokenPrices || {};
  const totalWindow = (promptTokens) => {
    const prompt = Number(promptTokens || 0);
    return prompt
      ? Math.min(maxContextWindowTokens, prompt + maxOutputTokens)
      : maxContextWindowTokens;
  };
  const defaultPromptTokens = Number(
    tokenPrices.maxPromptTokens || tokenPrices.contextMax || limits.max_prompt_tokens || 0,
  );
  const tiers = [{
    id: "default",
    maxPromptTokens: defaultPromptTokens || undefined,
    contextWindowTokens: totalWindow(defaultPromptTokens),
  }];

  const longContext = tokenPrices.longContext;
  const longPromptTokens = Number(longContext?.maxPromptTokens || longContext?.contextMax || 0);
  const longContextWindowTokens = totalWindow(longPromptTokens);
  if (longPromptTokens && longContextWindowTokens > tiers[0].contextWindowTokens) {
    tiers.push({
      id: "long_context",
      maxPromptTokens: longPromptTokens,
      contextWindowTokens: longContextWindowTokens,
    });
  }

  return tiers;
}

// Ordinal utilities used only by the workflow ranking. They are deliberately not exposed as
// factual quality or price measurements: Copilot publishes categories, not benchmark scores.
const COST_EFFICIENCY_BY_CATEGORY = { low: 5, medium: 3, high: 2, very_high: 1 };
const COMPLEX_TASK_FIT_BY_CATEGORY = { lightweight: 3, versatile: 4, powerful: 5 };

export function buildModelCatalogScores(model) {
  const costCategory = String(model?.modelPickerPriceCategory || "").trim().toLowerCase();
  const capabilityCategory = String(model?.modelPickerCategory || "").trim().toLowerCase();
  return {
    priceCategory: costCategory || "unknown",
    costEfficiencyScore: COST_EFFICIENCY_BY_CATEGORY[costCategory] || 3,
    capabilityCategory: capabilityCategory || "unknown",
    complexTaskFitScore: COMPLEX_TASK_FIT_BY_CATEGORY[capabilityCategory] || 3,
  };
}

export function normalizeCopilotQuota(quotaResult) {
  const snapshot = quotaResult?.quotaSnapshots?.premium_interactions;
  if (!snapshot) return null;

  const entitlement = Number(snapshot.entitlementRequests || 0);
  const used = Number(snapshot.usedRequests || 0);
  const unlimited = Boolean(snapshot.isUnlimitedEntitlement) || entitlement < 0;
  return {
    type: "premium_interactions",
    unlimited,
    entitlement: unlimited ? null : entitlement,
    used,
    remaining: unlimited ? null : Math.max(0, entitlement - used),
    remainingPercentage: Number(snapshot.remainingPercentage || 0),
    resetDate: snapshot.resetDate || null,
    hasQuota: snapshot.hasQuota !== false,
    tokenBasedBilling: Boolean(snapshot.tokenBasedBilling),
    overage: Number(snapshot.overage || 0),
    overageAllowed: Boolean(snapshot.overageAllowedWithExhaustedQuota),
  };
}

/**
 * Cuota premium de la cuenta: los creditos que la licencia trae y los que ya se han gastado, sea
 * quien sea quien los gasto (FENIX, el IDE, la CLI...). Es un dato distinto del consumo atribuible
 * a este producto, que se mide por sesion con `usage.getMetrics()` y se acumula en `run.usage`.
 *
 * `getLicensedModelCatalog` ya devuelve esta misma cuota, pero arrastra el catalogo entero de
 * modelos; esta variante existe para que las vistas puedan refrescar solo el contador.
 */
export async function getLicenseQuota(config) {
  const client = await createCopilotClient(config, config.storage.directory);
  try {
    await client.start();
    return normalizeCopilotQuota(await client.rpc.account.getQuota({}).catch(() => null));
  } finally {
    await client.stop().catch(() => []);
  }
}

export function supportsModelReasoningEffort(model) {
  return Boolean(
    model?.capabilities?.supports?.reasoningEffort
    || (Array.isArray(model?.supportedReasoningEfforts) && model.supportedReasoningEfforts.length),
  );
}

export async function getLicensedModelCatalog(config) {
  const client = await createCopilotClient(config, config.storage.directory);
  try {
    await client.start();
    const [models, quotaResult] = await Promise.all([
      client.listModels(),
      client.rpc.account.getQuota({}).catch(() => null),
    ]);
    return {
      models: models.map((model) => ({
        id: model.id,
        name: model.name || model.id,
        ...buildModelCatalogScores(model),
        supportsReasoningEffort: supportsModelReasoningEffort(model),
        supportedReasoningEfforts: model.supportedReasoningEfforts || [],
        defaultReasoningEffort: model.defaultReasoningEffort,
        maxPromptTokens: model.capabilities?.limits?.max_prompt_tokens,
        maxOutputTokens: model.capabilities?.limits?.max_output_tokens,
        maxContextWindowTokens: model.capabilities?.limits?.max_context_window_tokens,
        contextTiers: buildModelContextTiers(model),
        billing: model.billing,
      })),
      quota: normalizeCopilotQuota(quotaResult),
    };
  } finally {
    await client.stop().catch(() => []);
  }
}

export async function listLicensedModels(config) {
  return (await getLicensedModelCatalog(config)).models;
}

export function normalizeCopilotExecutionSettings(settings = {}) {
  const rawReasoningEffort = String(settings.reasoningEffort || "").trim().toLowerCase();
  const reasoningEffort = rawReasoningEffort && rawReasoningEffort !== "auto"
    ? rawReasoningEffort
    : undefined;
  if (reasoningEffort && !/^[a-z][a-z0-9_-]{0,31}$/.test(reasoningEffort)) {
    throw new Error(`Invalid reasoning effort identifier: ${reasoningEffort}.`);
  }

  const rawContextTier = String(settings.contextTier || "").trim().toLowerCase();
  const contextTier = rawContextTier && rawContextTier !== "auto" ? rawContextTier : undefined;
  if (contextTier && !["default", "long_context"].includes(contextTier)) {
    throw new Error(`Unsupported context tier: ${contextTier}.`);
  }

  return { reasoningEffort, contextTier };
}

const TOOL_PROFILES = Object.freeze({
  "no-tools": [],
  "analysis-readonly": ["grep", "glob", "view"],
  "implementation-guarded": ["grep", "glob", "view", "edit", "create"],
  implementation: ["grep", "glob", "view", "edit", "create"],
});

export function resolveCopilotAvailableTools({ availableTools, permissionProfile } = {}) {
  if (Array.isArray(availableTools)) return [...new Set(availableTools)];
  const profileTools = TOOL_PROFILES[permissionProfile];
  return profileTools ? [...profileTools] : availableTools;
}

export function buildCopilotAgentSessionSettings({
  availableTools,
  customAgents = [],
  permissionProfile,
  allowSubagents = false,
} = {}) {
  const effectiveTools = resolveCopilotAvailableTools({ availableTools, permissionProfile });
  if (!allowSubagents || !customAgents.length || permissionProfile === "no-tools") {
    return { availableTools: effectiveTools };
  }
  return {
    availableTools: [...new Set([...(effectiveTools || []), "task"])],
    customAgents,
    includeSubAgentStreamingEvents: true,
  };
}

export function finalAssistantMessageContent(event) {
  if (event?.type !== "assistant.message" || (event.data?.toolRequests || []).length) return "";
  return String(event.data?.content || "");
}

export function addUsage(total, data = {}) {
  if (data.provider) total.provider = data.provider;
  total.inputTokens += Number(data.inputTokens || 0);
  total.outputTokens += Number(data.outputTokens || 0);
  total.cacheReadTokens += Number(data.cacheReadTokens || 0);
  total.cacheWriteTokens += Number(data.cacheWriteTokens || 0);
  total.reasoningOutputTokens += Number(data.reasoningOutputTokens || 0);
  total.cost += Number(data.cost || 0);
  // `cost` is this call's premium-request cost with the model multiplier already applied (so it is
  // fractional for multiplied models), and copilotUsage.totalNanoAiu is what CAPI billed in nano-AI
  // units — the unit that matters on usage-based/AI-credit seats. Both are what GitHub actually
  // charges; neither is derivable from token counts, because the price per token varies by model
  // and context tier. Only user-initiated calls are billed as premium requests: sub-agent and
  // sampling calls carry an `initiator` and are excluded here so this stays comparable with
  // usage.getMetrics().totalPremiumRequestCost, which counts user-initiated calls only.
  if (!data.initiator) {
    total.premiumRequests += Number(data.cost || 0);
    total.userRequests += 1;
  }
  total.nanoAiu += Number(data.copilotUsage?.totalNanoAiu || 0);
  if (data.licenseUnitsMeasured) {
    total.licenseUnits = Number(total.licenseUnits || 0) + Number(data.licenseUnits || 0);
    total.licenseUnitsMeasured = true;
  }
  if (data.model) total.models.add(data.model);
  if (data.modelId) total.models.add(data.modelId);
}

export function emptyCopilotUsage(provider = "copilot") {
  return {
    provider,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningOutputTokens: 0,
    cost: 0,
    premiumRequests: 0,
    userRequests: 0,
    nanoAiu: 0,
    licenseUnits: 0,
    licenseUnitsMeasured: false,
    models: new Set(),
  };
}

/**
 * Session-scoped aggregate of what the session really billed, which is the same source the Copilot
 * CLI shows in its own usage report. Preferred over the per-call assistant.usage totals because it
 * is the SDK's own reconciliation of them.
 *
 * `usage.getMetrics` is flagged @experimental in the SDK and is missing on older copilot binaries,
 * so a failure here degrades to the accumulated events (same numbers, summed client-side) instead
 * of failing the step or silently reporting zero credits.
 */
export async function readSessionUsageMetrics(session) {
  try {
    const metrics = await session.rpc.usage.getMetrics();
    if (!metrics) return null;
    return {
      premiumRequests: Number(metrics.totalPremiumRequestCost || 0),
      userRequests: Number(metrics.totalUserRequests || 0),
      nanoAiu: Number(metrics.totalNanoAiu || 0),
    };
  } catch {
    return null;
  }
}

export async function sendAndValidateSession({
  session,
  prompt,
  timeoutMs,
  completionValidation,
}) {
  const maxAttempts = Math.max(1, Number(completionValidation?.maxAttempts || 1));
  let result;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptPrompt = attempt === 1
      ? prompt
      : typeof completionValidation.retryPrompt === "function"
        ? completionValidation.retryPrompt(attempt)
        : completionValidation.retryPrompt;
    result = await session.sendAndWait({ prompt: attemptPrompt }, timeoutMs);

    if (!completionValidation?.validate || await completionValidation.validate({ attempt, result })) {
      return { result, attemptsUsed: attempt };
    }
    if (attempt < maxAttempts) await completionValidation.onRetry?.({ attempt, nextAttempt: attempt + 1 });
  }

  throw completionValidationError(completionValidation, maxAttempts, result);
}

function completionValidationError(completionValidation, maxAttempts, result) {
  const error = new Error(completionValidation?.errorMessage || `Copilot did not satisfy the required completion condition after ${maxAttempts} attempts.`);
  error.code = "COPILOT_COMPLETION_VALIDATION_FAILED";
  error.lastContent = String(result?.data?.content || "");
  return error;
}

/**
 * Resolves the `model` / `reasoningEffort` / `contextTier` a session must be created with, validating
 * each of them against the catalog the authenticated license actually exposes (`client.listModels()`).
 * Returns only the keys that apply, so the result can be spread straight into a session config.
 *
 * Shared by the workflow engine (executeCopilotStep, one session per step) and the quick-chat pool
 * (chat-session-pool.mjs, one long-lived session per conversation): both read the same overrides
 * placed on `config.copilot` by applyOrchestratorExecutionSettings (workflow/loader.mjs), so a model
 * unavailable for the license fails identically in both instead of drifting apart.
 */
export async function resolveSessionModelSettings({ client, config }) {
  const executionSettings = normalizeCopilotExecutionSettings(config.copilot);
  const settings = {};

  const configuredModel = String(config.copilot.model || "").trim();
  const needsExplicitModel = executionSettings.reasoningEffort || executionSettings.contextTier;
  let selectedModel;
  if (configuredModel && configuredModel !== "auto") {
    const licensedModels = await client.listModels();
    selectedModel = licensedModels.find((model) => model.id === configuredModel);
    if (!selectedModel) {
      throw new Error(
        `Configured model ${configuredModel} is not available for the authenticated Copilot license.`,
      );
    }
    settings.model = configuredModel;
  } else if (needsExplicitModel) {
    throw new Error("Reasoning effort and context window size require selecting a specific Copilot model.");
  }

  if (executionSettings.reasoningEffort) {
    const supportedEfforts = selectedModel.supportedReasoningEfforts || [];
    if (!supportsModelReasoningEffort(selectedModel)
      || (supportedEfforts.length && !supportedEfforts.includes(executionSettings.reasoningEffort))) {
      throw new Error(
        `Reasoning effort ${executionSettings.reasoningEffort} is not supported by model ${configuredModel}.`,
      );
    }
    settings.reasoningEffort = executionSettings.reasoningEffort;
  }

  if (executionSettings.contextTier) {
    const contextTiers = buildModelContextTiers(selectedModel);
    if (!contextTiers.some((tier) => tier.id === executionSettings.contextTier)) {
      throw new Error(`Context tier ${executionSettings.contextTier} is not supported by model ${configuredModel}.`);
    }
    settings.contextTier = executionSettings.contextTier;
  }

  return settings;
}

export async function executeCopilotStep({
  config,
  workingDirectory,
  systemMessage,
  prompt,
  databaseTargetIds = [],
  availableTools,
  customAgents = [],
  allowSubagents = false,
  requireContent = false,
  completionValidation,
  loopGuardOptions,
  permissionProfile,
  copilotServices = {},
  onEvent,
  timeoutMs = 300000,
  // Optional cancellation.mjs token. When the associated run is cancelled while this session is
  // active, `session.abort()` is invoked immediately (stops the in-flight request from consuming
  // more tokens) instead of waiting for the current step to finish naturally.
  cancellationToken,
}) {
  cancellationToken?.throwIfCancelled();
  const finishTotal = performanceMonitor.start("copilot.step.total");
  const usage = emptyCopilotUsage();
  const evidenceSources = [];
  const workspaceChecks = [];
  const repositoryEvidence = new Set();
  const pendingRepositoryTools = new Map();

  const emitSource = (source) => {
    const tracedSource = {
      ...source,
      message: `Fuente revisada: ${source.sourceType} · ${source.title || source.path || source.sourceId || "sin titulo"}.`,
    };
    evidenceSources.push(tracedSource);
    onEvent?.({ timestamp: new Date().toISOString(), type: "fenix.source.reviewed", data: tracedSource });
  };
  const databaseTools = config.databases?.enabled !== false && config.databases?.targets?.length
    ? (copilotServices.createDatabaseTools || createDatabaseTools)({
      config,
      workingDirectory,
      targetIds: databaseTargetIds,
      onSource: emitSource,
      onAudit: (data) => onEvent?.({ timestamp: new Date().toISOString(), type: "fenix.database.audit", data }),
    })
    : null;
  let client;
  let session;
  let unregisterAbort;
  let finishSessionRun;
  let stepFailed = false;
  try {
    client = await (copilotServices.createClient || createCopilotClient)(config, workingDirectory);
    const finishClientStart = performanceMonitor.start("copilot.client.start");
    let clientStartFailed = false;
    try {
      await client.start();
    } catch (error) {
      clientStartFailed = true;
      throw error;
    } finally {
      finishClientStart({ error: clientStartFailed });
    }

    const finishModelResolution = performanceMonitor.start("copilot.models.resolve");
    let modelSettings;
    let modelResolutionFailed = false;
    try {
      modelSettings = await resolveSessionModelSettings({ client, config });
    } catch (error) {
      modelResolutionFailed = true;
      throw error;
    } finally {
      finishModelResolution({ error: modelResolutionFailed });
    }

    const agentSessionSettings = buildCopilotAgentSessionSettings({
      availableTools,
      customAgents,
      permissionProfile,
      allowSubagents,
    });
    const databaseToolNames = databaseTools?.copilotTools.map((tool) => tool.name) || [];
    const sessionConfig = {
      streaming: true,
      ...agentSessionSettings,
      ...(databaseTools ? {
        tools: databaseTools.copilotTools,
        availableTools: [...new Set([...(agentSessionSettings.availableTools || []), ...databaseToolNames])],
      } : {}),
      ...modelSettings,
      onPermissionRequest: createPermissionHandler(permissionProfile),
      systemMessage: {
        content: [
          systemMessage,
          databaseTools?.directive,
          buildOutputLanguageDirective(config.ui?.language),
        ].filter(Boolean).join("\n\n"),
      },
    };

    const finishSessionCreate = performanceMonitor.start("copilot.session.create");
    let sessionCreateFailed = false;
    try {
      session = await client.createSession(sessionConfig);
    } catch (error) {
      sessionCreateFailed = true;
      throw error;
    } finally {
      finishSessionCreate({ error: sessionCreateFailed });
    }
    finishSessionRun = performanceMonitor.start("copilot.session.run");
    unregisterAbort = cancellationToken?.registerAbort(() => session.abort());

    // When a response is long enough to exhaust the model's per-turn output/thinking budget,
    // the SDK auto-injects a synthetic "Please continue from where you left off." user message
    // (event.data.source === "thinking-exhausted-continuation") and starts a new turn whose
    // assistant.message only contains the tail of the answer. sendAndWait() below only returns
    // that final turn, so on its own it silently drops everything generated before the split.
    // Reconstruct the full answer here by concatenating assistant.message content across turns
    // whenever it's immediately preceded by one of these continuation prompts, and resetting
    // (not appending) otherwise — e.g. narration turns like "Voy a analizar..." said before a
    // tool call are unrelated fragments, not part of the final report, and must not be prepended.
    let accumulatedContent = "";
    let isContinuation = false;
    let loopError = null;
    const loopGuard = createCopilotLoopGuard(loopGuardOptions);
    session.on((event) => {
      if (event.type === "assistant.usage") {
        addUsage(usage, event.data);
      } else if (event.type === "user.message" && event.data?.source === "thinking-exhausted-continuation") {
        isContinuation = true;
      } else if (event.type === "assistant.message") {
        const content = finalAssistantMessageContent(event);
        if (content) {
          accumulatedContent = isContinuation ? accumulatedContent + content : content;
          isContinuation = false;
        }
      } else if (event.type === "tool.execution_start") {
        const toolName = String(event.data?.toolName || "");
        const args = event.data?.arguments || {};
        const target = args.path || args.filePath || args.includePattern || args.paths;
        if (["view", "grep", "glob"].includes(toolName) && target) {
          pendingRepositoryTools.set(event.data?.toolCallId, { toolName, target });
        }
      } else if (event.type === "tool.execution_complete" && event.data?.success !== false) {
        const reviewed = pendingRepositoryTools.get(event.data?.toolCallId);
        if (reviewed) {
          const sourceId = Array.isArray(reviewed.target) ? reviewed.target.join("|") : String(reviewed.target);
          if (!repositoryEvidence.has(sourceId)) {
            repositoryEvidence.add(sourceId);
            emitSource({
              sourceType: "repository",
              operation: reviewed.toolName,
              sourceId,
              path: sourceId,
              title: sourceId,
            });
          }
          pendingRepositoryTools.delete(event.data?.toolCallId);
        }
      }
      onEvent?.(event);
      const detectedLoop = loopGuard.inspect(event);
      if (detectedLoop && !loopError) {
        loopError = detectedLoop;
        onEvent?.({
          type: "fenix.loop-detected",
          timestamp: new Date().toISOString(),
          data: { message: detectedLoop.message, details: detectedLoop.details },
        });
        void session.abort().catch(() => undefined);
      }
    });

    let result;
    let completionAttempts = 1;
    try {
      const completion = await sendAndValidateSession({
        session,
        prompt,
        timeoutMs,
        completionValidation,
      });
      result = completion.result;
      completionAttempts = completion.attemptsUsed;
    } catch (error) {
      if (!loopError) {
        error.copilotUsage = { ...usage, models: [...usage.models] };
        throw error;
      }
      // The abort triggered by the loop guard is what made this reject; the loop is handled below.
      result = null;
    }
    if (loopError) {
      // Detecting repetition stops the exploration, but it should not throw away the work already
      // done: the session gets one last tool-less turn to write the report with what it knows, and
      // only a session that cannot even do that fails the step.
      onEvent?.({
        type: "fenix.loop-recovery",
        timestamp: new Date().toISOString(),
        data: { message: "Exploración interrumpida por repetición; se pide el informe final sin más herramientas." },
      });
      try {
        result = await session.sendAndWait({
          prompt: "Se ha interrumpido tu exploración porque estabas repitiendo la misma acción sin avanzar. No uses más herramientas: emite ahora, con lo que ya sabes, el informe final completo en el formato indicado originalmente.",
        }, timeoutMs);
      } catch {
        throw loopError;
      }
      if (!String(accumulatedContent || result?.data?.content || "").trim()) throw loopError;
      if (completionValidation?.validate
        && !await completionValidation.validate({ attempt: completionAttempts, result })) {
        throw completionValidationError(completionValidation, Math.max(1, Number(completionValidation.maxAttempts || 1)), result);
      }
    }
    if (requireContent && !String(accumulatedContent || result?.data?.content || "").trim()) {
      onEvent?.({
        type: "fenix.empty-response-retry",
        timestamp: new Date().toISOString(),
        data: { message: "La sesión terminó sin contenido; se solicita el informe final una vez más." },
      });
      try {
        result = await session.sendAndWait({
          prompt: "No has devuelto contenido. No uses más herramientas. Emite ahora el informe final completo solicitado, en el formato indicado originalmente.",
        }, timeoutMs);
      } catch (error) {
        throw loopError || error;
      }
      if (loopError) throw loopError;
      if (!String(accumulatedContent || result?.data?.content || "").trim()) {
        const emptyError = new Error("La sesión Copilot terminó sin producir el contenido requerido después de un reintento.");
        emptyError.code = "COPILOT_EMPTY_RESPONSE";
        throw emptyError;
      }
    }
    // session.abort() (triggered by the cancellation token above) makes sendAndWait settle
    // normally instead of rejecting — re-check here so a cancelled request is reported as
    // cancelled rather than silently returning as if it had completed successfully.
    cancellationToken?.throwIfCancelled();
    // Read while the session is still connected (the finally below disconnects it).
    const metrics = await readSessionUsageMetrics(session);
    return {
      content: accumulatedContent || result?.data?.content || "",
      sessionId: session.sessionId,
      completionAttempts,
      evidence: evidenceCoverage(evidenceSources, workspaceChecks),
      sources: evidenceSources,
      usage: {
        ...usage,
        ...(metrics || {}),
        models: [...usage.models],
      },
    };
  } catch (error) {
    stepFailed = true;
    throw error;
  } finally {
    unregisterAbort?.();
    finishSessionRun?.({ error: stepFailed });
    const finishClose = performanceMonitor.start("copilot.session.close");
    let closeFailed = false;
    let cleanupError = null;
    try {
      await session?.disconnect().catch(() => { closeFailed = true; });
      await client?.stop().catch(() => { closeFailed = true; });
      await databaseTools?.close().catch(() => { closeFailed = true; });
    } finally {
      finishClose({ error: closeFailed });
      finishTotal({ error: stepFailed });
    }
    if (cleanupError && !stepFailed) throw cleanupError;
  }
}
