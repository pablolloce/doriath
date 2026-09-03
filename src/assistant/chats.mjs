import path from "node:path";
import { randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { paths } from "../paths.mjs";
import { getConfig } from "../config.mjs";
import { readJson, writeJson, ensureDir, safeFileName, slugify } from "../util/fs.mjs";
import { eventBus } from "../util/events.mjs";
import { log } from "../util/log.mjs";
import { sessionPool, defineDoriathTool } from "../ai/copilot.mjs";
import { loadSpecDrivenPrompt, loadPrompt, loadVerticalTaxonomy, renderTemplate } from "../ai/prompts.mjs";
import { createKddTools, describeTools } from "../ai/tools.mjs";
import { getSource, listSources, touchSource } from "../knowledge/sources.mjs";
import { getSpecStore } from "../kdd/store.mjs";
import { specsInventoryText, specsCatalogText, decisionHistoryText, relevantSpecsText } from "../knowledge/context.mjs";
import { extractDocumentText } from "../knowledge/extract.mjs";
import { loadJob } from "../knowledge/analysis-store.mjs";
import { applyResolutionActions } from "../knowledge/analyzer.mjs";
import { listRegisteredRepositories } from "../work/repos.mjs";
import { splitNarrativeAndActions, buildPackagePreview, persistPackage } from "../work/packages.mjs";
import { buildDocx } from "./generators/docx.mjs";
import { buildXlsx } from "./generators/xlsx.mjs";
import { buildPptx } from "./generators/pptx.mjs";
import { buildHtmlDocument } from "./generators/html.mjs";
import { writeOutput } from "./outputs.mjs";

/**
 * Conversaciones con el modelo. Cuatro tipos:
 *  - assistant:  BBVA CIB Assistant (contexto: todas las bases de conocimiento; genera ficheros).
 *  - work:       creación de iniciativas KDD (WRK-SPEC → PLAN → TASK) en 4 fases, con repositorios.
 *  - knowledge:  creación manual de specs de conocimiento/gobernanza (entrevista estricta).
 *  - resolution: resolución de preguntas/conflictos de un análisis antes de persistir.
 *
 * El transcript se guarda en disco; la sesión Copilot viva se mantiene en el pool y, si caduca, se
 * reconstruye el contexto a partir del historial.
 */
const TRANSCRIPT_CONTEXT_MESSAGES = 12;

function chatFile(chatId) {
  return path.join(paths.chatsDir, `${chatId}.json`);
}

export async function listChats({ kind, sourceId } = {}) {
  await ensureDir(paths.chatsDir);
  const files = (await readdir(paths.chatsDir)).filter((name) => name.endsWith(".json"));
  const chats = [];
  for (const file of files) {
    const chat = await readJson(path.join(paths.chatsDir, file), null);
    if (!chat) continue;
    if (kind && chat.kind !== kind) continue;
    if (sourceId && !(chat.sourceIds || []).includes(sourceId)) continue;
    chats.push({ id: chat.id, kind: chat.kind, title: chat.title, sourceIds: chat.sourceIds, jobId: chat.jobId, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: chat.messages.length, phase: chat.state?.phase || "", hasPackage: Boolean(chat.state?.package), busy: Boolean(chat.busy) });
  }
  return chats.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function loadChat(chatId) {
  const chat = await readJson(chatFile(chatId), null);
  if (!chat) throw Object.assign(new Error(`Conversación no encontrada: ${chatId}`), { status: 404 });
  return chat;
}

async function saveChat(chat) {
  chat.updatedAt = new Date().toISOString();
  await writeJson(chatFile(chat.id), chat);
  return chat;
}

export async function createChat({ kind = "assistant", title, sourceIds = [], repoIds = [], jobId = "", model = "" }) {
  if (!["assistant", "work", "knowledge", "resolution"].includes(kind)) throw Object.assign(new Error("Tipo de conversación no válido."), { status: 400 });
  let sources = sourceIds;
  if (kind === "assistant" && !sources.length) sources = (await listSources()).filter((source) => source.exists).map((source) => source.id);
  if (kind !== "assistant" && kind !== "resolution" && sources.length !== 1) throw Object.assign(new Error("Selecciona exactamente una base de conocimiento."), { status: 400 });
  if (kind === "resolution" && !jobId) throw Object.assign(new Error("El chat de resolución necesita un análisis."), { status: 400 });
  if (kind === "resolution" && !sources.length) sources = [(await loadJob(jobId)).sourceId];
  const chat = {
    id: randomUUID(),
    kind,
    title: title || defaultTitle(kind),
    sourceIds: sources,
    repoIds,
    jobId,
    model,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    state: { phase: "", sourceCode: "", package: null, repositories: [] },
    busy: false,
  };
  await saveChat(chat);
  return chat;
}

function defaultTitle(kind) {
  const stamp = new Date().toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return { assistant: `Conversación ${stamp}`, work: `Iniciativa ${stamp}`, knowledge: `Specs ${stamp}`, resolution: `Resolución ${stamp}` }[kind];
}

export async function deleteChat(chatId) {
  await sessionPool.release(chatId).catch(() => undefined);
  const { unlink } = await import("node:fs/promises");
  await unlink(chatFile(chatId)).catch(() => undefined);
  return true;
}

export async function updateChat(chatId, patch) {
  const chat = await loadChat(chatId);
  if (patch.title) chat.title = String(patch.title).slice(0, 120);
  if (Array.isArray(patch.sourceIds) && chat.kind === "assistant") {
    chat.sourceIds = patch.sourceIds;
    await sessionPool.release(chatId).catch(() => undefined);
  }
  if (Array.isArray(patch.repoIds)) {
    chat.repoIds = patch.repoIds;
    await sessionPool.release(chatId).catch(() => undefined);
  }
  if (patch.model !== undefined) {
    chat.model = String(patch.model || "");
    await sessionPool.release(chatId).catch(() => undefined);
  }
  return saveChat(chat);
}

/* ---------- Contextos ---------- */

async function loadContexts(chat) {
  const contexts = [];
  for (const id of chat.sourceIds) {
    try {
      const source = await getSource(id);
      const store = await getSpecStore(source.path).load();
      contexts.push({ source, store });
    } catch (error) {
      log.warn("chat", `Base de conocimiento ${id} no disponible: ${error.message}`);
    }
  }
  return contexts;
}

async function loadRepos(chat, contexts) {
  if (!contexts.length) return [];
  const registered = await listRegisteredRepositories(contexts[0].source.path);
  const wanted = chat.repoIds?.length ? registered.filter((repo) => chat.repoIds.includes(repo.id)) : registered;
  return wanted.filter((repo) => repo.exists);
}

/* ---------- Herramientas de generación de ficheros (assistant) ---------- */

async function createOutputTools(chat) {
  const tools = [];
  const publishFile = (file) => {
    chat.state.files = [...(chat.state.files || []), { ...file, at: new Date().toISOString() }];
    eventBus.publish(`chat:${chat.id}`, "file", file);
    return `Fichero generado: ${file.name} (${file.size} bytes). Ruta: ${file.path}. Enlace de descarga: ${file.url}`;
  };
  tools.push(await defineDoriathTool("write_output_file", {
    description: "Escribe un fichero de texto en la carpeta de salidas de la conversación (Markdown, código, JSON, CSV, YAML, SQL, HTML, TXT...). Úsalo para cualquier entregable textual o de código. Devuelve la ruta y el enlace de descarga.",
    parameters: { type: "object", properties: { name: { type: "string", description: "Nombre con extensión, p. ej. informe.md o consulta.sql" }, content: { type: "string" } }, required: ["name", "content"] },
    handler: async ({ name, content }) => publishFile(await writeOutput(chat, name, String(content))),
  }));
  tools.push(await defineDoriathTool("generate_docx", {
    description: "Genera un documento Word (.docx) con la identidad BBVA (tipografías Source Serif 4 y Lato, Electric Blue, logos BBVA y NFQ). Pasa el contenido estructurado; el diseño lo aplica Doriath.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del fichero, p. ej. informe-var.docx" },
        title: { type: "string" },
        subtitle: { type: "string" },
        kicker: { type: "string", description: "Antetítulo corto (por defecto BBVA CIB)" },
        author: { type: "string" },
        sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, level: { type: "number", description: "1, 2 o 3" }, paragraphs: { type: "array", items: { type: "string" } }, bullets: { type: "array", items: { type: "string" } }, numbered: { type: "array", items: { type: "string" } }, callout: { type: "string", description: "Frase destacada en caja Serene" }, code: { type: "string" }, table: { type: "object", properties: { headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } } } } } },
      },
      required: ["name", "title", "sections"],
    },
    handler: async ({ name, ...model }) => publishFile(await writeOutput(chat, name.endsWith(".docx") ? name : `${name}.docx`, await buildDocx(model))),
  }));
  tools.push(await defineDoriathTool("generate_xlsx", {
    description: "Genera un libro Excel (.xlsx) con una o varias hojas (cabeceras + filas). Útil para tablas, matrices de pruebas (C204), inventarios.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        title: { type: "string" },
        sheets: { type: "array", items: { type: "object", properties: { name: { type: "string" }, title: { type: "string" }, headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } }, widths: { type: "array", items: { type: "number" } } }, required: ["name", "headers", "rows"] } },
      },
      required: ["name", "sheets"],
    },
    handler: async ({ name, ...model }) => publishFile(await writeOutput(chat, name.endsWith(".xlsx") ? name : `${name}.xlsx`, buildXlsx(model))),
  }));
  tools.push(await defineDoriathTool("generate_pptx", {
    description: "Genera una presentación PowerPoint (.pptx) con la identidad BBVA × NFQ (16:9, combos Sand/Serene/Electric/Midnight, logos, tipografías). Tipos de diapositiva: cover, section, content, bullets, cards, table, quote, closing.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        title: { type: "string" },
        subtitle: { type: "string" },
        footer: { type: "string", description: "Texto corto del pie en las diapositivas interiores" },
        slides: { type: "array", items: { type: "object", properties: { kind: { type: "string", description: "cover | section | content | bullets | cards | table | quote | closing" }, kicker: { type: "string", description: "Breadcrumb o número de sección" }, title: { type: "string" }, subtitle: { type: "string" }, body: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, cards: { type: "array", items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } } } }, table: { type: "object", properties: { headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: "string" } } } } }, combo: { type: "string", description: "sand | serene | electric | midnight (opcional)" } } } },
      },
      required: ["name", "title", "slides"],
    },
    handler: async ({ name, ...model }) => publishFile(await writeOutput(chat, name.endsWith(".pptx") ? name : `${name}.pptx`, await buildPptx(model))),
  }));
  tools.push(await defineDoriathTool("generate_html_document", {
    description: "Genera un documento HTML autocontenido con la identidad BBVA a partir de Markdown (para informes navegables o para imprimir a PDF desde el navegador).",
    parameters: { type: "object", properties: { name: { type: "string" }, title: { type: "string" }, subtitle: { type: "string" }, markdown: { type: "string" } }, required: ["name", "title", "markdown"] },
    handler: async ({ name, ...model }) => publishFile(await writeOutput(chat, name.endsWith(".html") ? name : `${name}.html`, await buildHtmlDocument(model))),
  }));
  return tools;
}

/* ---------- Prompts por tipo ---------- */

async function assistantSystemPrompt(chat, contexts, tools) {
  const catalog = contexts.map((context) => `## ${context.source.name} (${context.source.sourceId})\n${context.source.description ? `${context.source.description}\n` : ""}${specsCatalogText(context.store.all(), { withSummary: true, max: 150 })}`).join("\n\n");
  return `Eres el **BBVA CIB Assistant** de Doriath, un asistente de NFQ para los equipos de Corporate & Investment Banking de BBVA. Respondes en español, con tono sobrio y editorial (frases declarativas, datos concretos, sin exclamaciones ni emojis).

## Fuente de verdad
Tu contexto son las bases de conocimiento KDD disponibles (specs de arquitectura, dominio, producto, funcionalidad, documentación, gobernanza y trabajo). No recuerdas su contenido: lo CONSULTAS con las herramientas antes de afirmar nada. Cita los identificadores de las specs en las que te apoyas (por ejemplo DOM-RISK-S001-002). Si el conocimiento no está en las bases, dilo explícitamente y distingue lo que es conocimiento de la caja de lo que es conocimiento general.

## Herramientas
${describeTools(tools)}

## Generación de ficheros
El usuario puede pedirte cualquier entregable. Elige el formato más adecuado y genéralo con la herramienta correspondiente sin pedir permiso: Word (generate_docx) para informes y documentos; Excel (generate_xlsx) para tablas, inventarios y matrices de pruebas; PowerPoint (generate_pptx) para presentaciones; HTML (generate_html_document) para informes navegables; write_output_file para Markdown, código, SQL, JSON, CSV o cualquier fichero de texto. Si el usuario indica un formato, respétalo. Los documentos generados llevan automáticamente la identidad visual BBVA × NFQ: tú aportas contenido estructurado y bien jerarquizado (títulos cortos, párrafos breves, listas, tablas), no maquetación. Tras generar un fichero, resume en una frase qué contiene y dónde está.

## Estilo del contenido
- Un titular por sección, párrafos cortos, listas cuando haya elementos paralelos.
- Datos concretos y verificables; nada inventado.
- Español para la narrativa; los términos técnicos estándar (REST, batch, schema) se mantienen.

## Catálogo de bases de conocimiento disponibles
${catalog || "(no hay bases de conocimiento registradas todavía)"}`;
}

async function workSystemPrompt(chat, contexts, repos, tools) {
  const context = contexts[0];
  const template = await loadSpecDrivenPrompt("create-work-chat");
  const decisions = await context.store.readDecisionHistory();
  const taskKinds = [
    "- `implementation`: la tarea consiste en modificar código en uno o varios repositorios (Doriath la ejecuta con el agente Copilot sobre los repos seleccionados).",
    "- `document`: la tarea produce un documento (Markdown/Word) a partir del contexto.",
    "- `test-cases`: la tarea produce un documento de casos de prueba (C204 en Excel).",
    "- `manual`: la tarea la realiza una persona fuera de Doriath (despliegue, aprobación, reunión).",
  ].join("\n");
  const repoBlock = repos.length
    ? repos.map((repo) => `- **${repo.name}** — ruta ${repo.path} · rama ${repo.branch || "?"} · ${repo.stacks?.map((stack) => stack.label).join(", ") || "stack no detectado"}${repo.remote ? ` · remoto ${repo.remote}` : ""}${repo.summary ? `\n  ${repo.summary}` : ""}`).join("\n")
    : "(todavía no hay repositorios seleccionados; pide al usuario que seleccione las carpetas de los repositorios afectados desde Doriath)";
  const tuned = renderTemplate(template, {
    SOURCE_UUAAS: context.source.sourceId,
    SPECS_INVENTORY: specsInventoryText(context.store.all()),
    DECISION_HISTORY: decisionHistoryText(decisions),
    VERTICAL_TAXONOMY: await loadVerticalTaxonomy("cib-taxonomy"),
    TASK_KINDS_SECTION: taskKinds,
    TOOLS_SECTION: `## Herramientas disponibles\n\nConsulta el conocimiento y los repositorios con estas herramientas antes de decidir (no recuerdas su contenido):\n${describeTools(tools)}`,
  });
  return `${tuned}

## Repositorios (Doriath)

Doriath ejecutará las tareas de tipo \`implementation\` directamente sobre repositorios Git locales que el usuario selecciona. Repositorios ya seleccionados para esta caja:

${repoBlock}

Reglas adicionales de Doriath:
- **Vocabulario con la persona**: quien usa este módulo no sabe qué es una spec y no tiene por qué saberlo. En tu prosa NO digas «spec», «WRK-SPEC», «WRK-PLAN», «WRK-TASK», «paquete», «capa» ni «frontmatter». Di **iniciativa** (lo que se quiere conseguir), **feature** (cada bloque de trabajo) e **historia de usuario** (cada pieza concreta). Los identificadores solo aparecen dentro de los bloques que emites, nunca en la conversación. Los términos de Git (rama, commit, pull request) sí se usan con normalidad.
- Source ID de la caja activa: **${context.source.sourceId}**. Usa siempre ese código en los identificadores.
- En cuanto tengas claro qué repositorios toca la iniciativa, emite en una línea propia el marcador \`#REPOSITORIES: <nombre1>, <nombre2>\` con los nombres exactos de la lista anterior (o \`#REPOSITORIES: ninguno\` si no toca código). Si la iniciativa necesita un repositorio que no está en la lista, dilo con claridad y pide al usuario que lo seleccione (ruta local) antes de la fase de plan.
- Antes de planificar, inspecciona los repositorios con \`repo_tree\`, \`grep_repo\` y \`read_repo_file\` para que el plan cite módulos y ficheros reales.
- En cada WRK-TASK de tipo \`implementation\`, incluye en \`## Implementation Notes\` el repositorio (nombre exacto) y los ficheros o módulos a tocar. Doriath lee ese nombre para saber sobre qué repositorio ejecutar la tarea.
- Idioma: español.`;
}

async function knowledgeSystemPrompt(chat, contexts, tools) {
  const context = contexts[0];
  const template = await loadSpecDrivenPrompt("create-spec-chat");
  const decisions = await context.store.readDecisionHistory();
  const tuned = renderTemplate(template, {
    SOURCE_UUAAS: context.source.sourceId,
    SPECS_INVENTORY: specsInventoryText(context.store.all()),
    DECISION_HISTORY: decisionHistoryText(decisions),
    VERTICAL_TAXONOMY: await loadVerticalTaxonomy("cib-taxonomy"),
    TOOLS_SECTION: `## Herramientas disponibles\n\n${describeTools(tools)}`,
  });
  return `${tuned}\n\n## Doriath\n\n- Source ID de la caja activa: **${context.source.sourceId}** (emite \`#CREATION_SOURCE_ID: ${context.source.sourceId}\`).\n- Idioma: español.`;
}

async function resolutionSystemPrompt(chat, contexts, tools) {
  const job = await loadJob(chat.jobId);
  const context = contexts[0];
  const template = await loadSpecDrivenPrompt("resolution-chat");
  const preview = job.preview || { specs: [], openQuestions: [], conflicts: [] };
  const decisions = await context.store.readDecisionHistory();
  const questions = [...preview.openQuestions, ...preview.conflicts].map((item) => `- ${item.id} [${item.kind}${item.resolved ? ", resuelta" : ", pendiente"}]: ${item.text}${item.resolution ? ` → ${item.resolution}` : ""}`).join("\n") || "(sin preguntas ni conflictos)";
  const previewSummary = preview.specs.map((spec) => `- ${spec.id} (${spec.action}, ${spec.layer}): ${spec.title}${spec.blocking ? " — con incidencias bloqueantes" : ""}`).join("\n") || "(sin specs en el preview)";
  return renderTemplate(template, {
    DOC_NAME: job.documents.join(", "),
    UUAA: context.source.sourceId,
    ANALYSIS_DATE: job.analysisDate,
    ANALYSIS_SUMMARY: preview.summary || "",
    PREVIEW_SPEC_IDS: preview.specs.map((spec) => spec.id).join(", "),
    PREVIEW_SPECS_SUMMARY: previewSummary,
    RELEVANT_SPECS: relevantSpecsText(context.store.all(), preview.specs.map((spec) => `${spec.title} ${spec.body.slice(0, 300)}`).join(" "), { limit: 6, bodyChars: 1500 }),
    SPECS_INVENTORY: specsInventoryText(context.store.all()),
    VERTICAL_TAXONOMY: await loadVerticalTaxonomy("cib-taxonomy"),
    DECISION_HISTORY: decisionHistoryText(decisions),
    QUESTIONS_AND_CONFLICTS: questions,
    TOOLS_SECTION: `## Herramientas disponibles\n\n${describeTools(tools)}\n\nLos bodies completos de las specs del preview se adjuntan en el mensaje del usuario cuando se mencionan por id.`,
  });
}

/* ---------- Turnos ---------- */

function transcriptContext(chat) {
  const recent = chat.messages.slice(-TRANSCRIPT_CONTEXT_MESSAGES);
  if (!recent.length) return "";
  const lines = recent.map((message) => `${message.role === "user" ? "Usuario" : "Asistente"}: ${String(message.content || "").slice(0, 2500)}`);
  return `<historial_previo>\nLa sesión se ha reiniciado. Este es el historial reciente de la conversación; continúa desde aquí sin repetirlo.\n\n${lines.join("\n\n")}\n</historial_previo>\n\n`;
}

async function storeAttachments(chat, attachments) {
  const stored = [];
  if (!Array.isArray(attachments)) return stored;
  const dir = path.join(paths.uploadsDir, chat.id);
  await ensureDir(dir);
  for (const attachment of attachments) {
    if (!attachment?.name || !attachment?.base64) continue;
    const buffer = Buffer.from(String(attachment.base64), "base64");
    const file = path.join(dir, `${Date.now()}-${safeFileName(attachment.name)}`);
    await writeFile(file, buffer);
    let text = "";
    let image = false;
    try {
      const extracted = await extractDocumentText(file, buffer);
      text = extracted.text;
      image = Boolean(extracted.image);
    } catch (error) {
      text = `(no se pudo extraer texto: ${error.message})`;
    }
    stored.push({ name: attachment.name, path: file, size: buffer.length, text, image });
  }
  return stored;
}

function previewSpecBlocks(chat, job, text) {
  if (!job?.preview) return "";
  const mentioned = job.preview.specs.filter((spec) => text.toUpperCase().includes(spec.id));
  if (!mentioned.length) return "";
  return `\n\n<specs_preview>\n${mentioned.map((spec) => `### ${spec.id} (${spec.action}) — ${spec.layer}\n${spec.body}`).join("\n\n")}\n</specs_preview>`;
}

export async function sendMessage(chatId, { text, attachments = [] }) {
  const chat = await loadChat(chatId);
  if (chat.busy) throw Object.assign(new Error("La conversación ya está procesando un mensaje."), { status: 409 });
  const content = String(text || "").trim();
  if (!content && !attachments.length) throw Object.assign(new Error("Escribe un mensaje."), { status: 400 });
  const config = getConfig();
  const contexts = await loadContexts(chat);
  if (!contexts.length && chat.kind !== "assistant") throw Object.assign(new Error("La base de conocimiento de la conversación no está disponible."), { status: 409 });
  for (const context of contexts) await touchSource(context.source.id);
  const repos = chat.kind === "work" ? await loadRepos(chat, contexts) : [];
  const kddTools = await createKddTools({ contexts, repos });
  const tools = chat.kind === "assistant" ? [...kddTools, ...(await createOutputTools(chat))] : kddTools;
  let systemMessage;
  if (chat.kind === "assistant") systemMessage = await assistantSystemPrompt(chat, contexts, tools);
  else if (chat.kind === "work") systemMessage = await workSystemPrompt(chat, contexts, repos, tools);
  else if (chat.kind === "knowledge") systemMessage = await knowledgeSystemPrompt(chat, contexts, tools);
  else systemMessage = await resolutionSystemPrompt(chat, contexts, tools);

  const stored = await storeAttachments(chat, attachments);
  const userMessage = { id: randomUUID(), role: "user", content, at: new Date().toISOString(), attachments: stored.map((item) => ({ name: item.name, size: item.size })) };
  chat.messages.push(userMessage);
  chat.busy = true;
  await saveChat(chat);
  eventBus.publish(`chat:${chat.id}`, "user", { message: userMessage });

  const channel = `chat:${chat.id}`;
  try {
    const { fresh } = await sessionPool.acquire(chat.id, {
      config,
      workingDirectory: contexts[0]?.source.path || paths.dataRoot,
      systemMessage,
      tools,
      permissionProfile: "readonly",
      model: chat.model || undefined,
    });
    let prompt = fresh ? transcriptContext(chat) : "";
    prompt += content || "(el usuario adjunta ficheros sin texto)";
    const documents = stored.filter((item) => item.text && !item.image);
    if (documents.length) prompt += `\n\n${documents.map((item) => `<document name="${item.name}">\n${item.text.slice(0, 120000)}\n</document>`).join("\n\n")}`;
    if (chat.kind === "resolution") prompt += previewSpecBlocks(chat, await loadJob(chat.jobId), content);
    const sdkAttachments = stored.filter((item) => item.image).map((item) => ({ type: "file", path: item.path, displayName: item.name }));
    const result = await sessionPool.send(chat.id, {
      prompt,
      attachments: sdkAttachments.length ? sdkAttachments : undefined,
      timeoutMs: config.copilot.timeoutMs,
      onEvent: (event) => eventBus.publish(channel, event.type, event),
    });
    const assistantMessage = await handleAssistantOutput(chat, contexts, result.content, { model: result.model, usage: result.usage });
    chat.messages.push(assistantMessage);
    if (chat.messages.length === 2 && chat.title === defaultTitle(chat.kind)) chat.title = content.slice(0, 60) || chat.title;
    chat.busy = false;
    await saveChat(chat);
    eventBus.publish(channel, "assistant", { message: assistantMessage, state: chat.state });
    return { message: assistantMessage, state: chat.state };
  } catch (error) {
    chat.busy = false;
    const failure = { id: randomUUID(), role: "assistant", content: "", error: error.message, at: new Date().toISOString() };
    chat.messages.push(failure);
    await saveChat(chat);
    eventBus.publish(channel, "assistant", { message: failure, state: chat.state, error: error.message });
    throw error;
  }
}

async function handleAssistantOutput(chat, contexts, raw, meta) {
  const message = { id: randomUUID(), role: "assistant", content: raw, at: new Date().toISOString(), model: meta.model, usage: meta.usage };
  if (chat.kind === "assistant") return message;
  const parsed = splitNarrativeAndActions(raw);
  message.content = parsed.narrative || raw;
  message.raw = raw;
  if (parsed.phase) chat.state.phase = parsed.phase;
  if (parsed.sourceId) chat.state.sourceCode = parsed.sourceId;
  if (parsed.repositories.length) chat.state.repositories = parsed.repositories;
  if (parsed.actions && !parsed.actions.error) {
    if (chat.kind === "resolution") {
      const { applied } = await applyResolutionActions(chat.jobId, parsed.actions);
      message.applied = applied;
    } else {
      const context = contexts[0];
      const pkg = buildPackagePreview(parsed.actions, { store: context.store, sourceId: context.source.sourceId, kind: chat.kind });
      chat.state.package = pkg;
      message.packageId = pkg.id;
    }
  } else if (parsed.actions?.error) {
    message.actionError = parsed.actions.error;
  }
  return message;
}

export async function abortChat(chatId) {
  const aborted = await sessionPool.abort(chatId);
  const chat = await loadChat(chatId);
  chat.busy = false;
  await saveChat(chat);
  return aborted;
}

export async function updatePackageSpec(chatId, specId, patch) {
  const chat = await loadChat(chatId);
  const pkg = chat.state.package;
  if (!pkg) throw Object.assign(new Error("La conversación no tiene un paquete pendiente."), { status: 404 });
  const spec = pkg.specs.find((item) => item.id === specId) || pkg.modifications.find((item) => item.id === specId);
  if (!spec) throw Object.assign(new Error("Spec no encontrada en el paquete."), { status: 404 });
  for (const key of ["title", "body", "selected", "status", "confidence", "owner", "task_kind"]) if (patch[key] !== undefined) spec[key] = patch[key];
  if (spec.layer) {
    const { validateSpecStructure } = await import("../kdd/sections.mjs");
    spec.issues = validateSpecStructure(spec);
    spec.blocking = spec.issues.some((issue) => issue.severity === "error");
    pkg.blocking = pkg.specs.some((item) => item.blocking && item.selected !== false);
  }
  await saveChat(chat);
  return pkg;
}

export async function confirmPackage(chatId, { force = false } = {}) {
  const chat = await loadChat(chatId);
  const pkg = chat.state.package;
  if (!pkg) throw Object.assign(new Error("La conversación no tiene un paquete pendiente."), { status: 404 });
  const contexts = await loadContexts(chat);
  const context = contexts[0];
  const results = await persistPackage(pkg, { store: context.store, sourceCode: context.source.sourceId, generatedBy: `doriath-${chat.kind}-chat`, force });
  chat.state.persisted = [...(chat.state.persisted || []), { packageId: pkg.id, at: new Date().toISOString(), results }];
  chat.state.package = null;
  await saveChat(chat);
  await sessionPool.release(chatId).catch(() => undefined);
  eventBus.publish(`chat:${chat.id}`, "package-persisted", { results });
  return { results, persisted: chat.state.persisted };
}

export async function discardPackage(chatId) {
  const chat = await loadChat(chatId);
  chat.state.package = null;
  await saveChat(chat);
  return true;
}
