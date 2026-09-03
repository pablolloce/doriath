import { HttpError, sendFile } from "../server.mjs";
import { listSources, getSource, addExistingSource, createSource, updateSource, removeSource, touchSource } from "../knowledge/sources.mjs";
import { getSpecStore } from "../kdd/store.mjs";
import { buildGraph, graphStats, graphView, impact, validateGraph, orphans, pathBetween, activationBundle, renderActivationBundle } from "../kdd/graph.mjs";
import { validateSpecStructure } from "../kdd/sections.mjs";
import { buildSpecIndex, snippetFor } from "../kdd/search.mjs";
import { allocateSpecId, parseSpecId } from "../kdd/ids.mjs";
import { LAYERS, ALL_LAYERS } from "../kdd/layout.mjs";
import { serializeSpecMarkdown } from "../kdd/frontmatter.mjs";
import { listDocuments, saveDocument, deleteDocument, getDocumentText } from "../knowledge/documents.mjs";
import { startAnalysis, getAnalysis, cancelAnalysis, confirmAnalysis, discardAnalysis, updatePreviewSpec, resolvePreviewQuestion } from "../knowledge/analyzer.mjs";
import { listJobs, deleteJob, readPendingTasks, resolvePendingTask } from "../knowledge/analysis-store.mjs";
import { recordActivity, listActivity, documentsMeta, recordDocumentImport, attachSpecsToDocuments, forgetDocument } from "../kdd/activity.mjs";
import { currentActor } from "../auth/gh.mjs";
import { getConfig } from "../config.mjs";

async function context(id) {
  const source = await getSource(id);
  const store = await getSpecStore(source.path).load();
  return { source, store };
}

/** Quién firma el cambio: el usuario de la sesión de GitHub. */
function actor() {
  return currentActor(getConfig().github.host);
}

export function registerKnowledgeRoutes(router) {
  /* ---------- Bases de conocimiento ---------- */
  router.get("/api/sources", async ({ query }) => ({ sources: await listSources({ withStats: query.stats !== "0" }), layers: ALL_LAYERS.map((layer) => ({ id: layer, ...LAYERS[layer], sections: undefined })) }));
  router.post("/api/sources/add", async ({ body }) => addExistingSource(body?.path, { name: body?.name, description: body?.description }));
  router.post("/api/sources/create", async ({ body }) => createSource({ name: body?.name, description: body?.description, parentDir: body?.parentDir, sourceId: body?.sourceId }));
  router.put("/api/sources/:id", async ({ params, body }) => updateSource(params.id, body || {}));
  router.delete("/api/sources/:id", async ({ params }) => ({ removed: await removeSource(params.id) }));
  router.post("/api/sources/:id/touch", async ({ params }) => touchSource(params.id));

  router.get("/api/sources/:id/overview", async ({ params }) => {
    const { source, store } = await context(params.id);
    const graph = buildGraph(store.all());
    const documents = await listDocuments(source.path);
    const pending = await readPendingTasks(source.path);
    return { source, stats: graphStats(graph), documents: documents.length, pending: pending.length, problems: store.problems, issues: validateGraph(graph) };
  });

  /* ---------- Specs ---------- */
  router.get("/api/sources/:id/specs", async ({ params, query }) => {
    const { store } = await context(params.id);
    let specs = store.catalog();
    if (query.layer) specs = specs.filter((spec) => spec.layer === query.layer);
    if (query.axis) specs = specs.filter((spec) => spec.axis === query.axis);
    if (query.status) specs = specs.filter((spec) => spec.status === query.status);
    return { specs, problems: store.problems };
  });

  router.get("/api/sources/:id/specs/:specId", async ({ params }) => {
    const { store } = await context(params.id);
    const spec = store.get(params.specId);
    if (!spec) throw new HttpError(404, `La spec ${params.specId} no existe.`);
    const graph = buildGraph(store.all());
    return { spec, issues: validateSpecStructure(spec), impact: impact(graph, spec.id).map((item) => ({ id: item.id, via: item.via, depth: item.depth, title: item.spec?.title || "" })), markdown: serializeSpecMarkdown(spec) };
  });

  router.post("/api/sources/:id/specs", async ({ params, body }) => {
    const { source, store } = await context(params.id);
    const layer = body?.layer;
    if (!LAYERS[layer]) throw new HttpError(400, "Capa no válida.");
    const id = body?.id ? String(body.id).toUpperCase() : allocateSpecId(store.ids(), { layer, domain: body?.domain ? String(body.domain).toUpperCase().replace(/[^A-Z0-9-]/g, "") : "", sourceId: source.sourceId });
    if (!parseSpecId(id)) throw new HttpError(400, "Identificador no válido.");
    const spec = await store.create({
      id, layer, axis: LAYERS[layer].axis, title: body?.title || id, status: body?.status, confidence: body?.confidence, owner: body?.owner || "", domain: body?.domainName || "", subdomain: body?.subdomain || "", tags: body?.tags || [], dependencies: body?.dependencies || [], activates: body?.activates || [], parent: body?.parent || "", source: source.sourceId, body: body?.body || defaultBody(layer),
    }, { generatedBy: "doriath-manual" });
    await recordActivity(source.path, { actor: await actor(), kind: "edit", title: `Creó ${spec.id}`, detail: spec.title, specs: [spec.id] });
    return { spec };
  });

  router.put("/api/sources/:id/specs/:specId", async ({ params, body }) => {
    const { source, store } = await context(params.id);
    const { spec } = await store.update(params.specId, body || {}, { manual: true, bump: body?.bump === undefined ? "patch" : body.bump });
    await recordActivity(source.path, { actor: await actor(), kind: "edit", title: `Modificó ${spec.id}`, detail: body?.reason || `Versión ${spec.version}`, specs: [spec.id] });
    return { spec, issues: validateSpecStructure(spec) };
  });

  router.post("/api/sources/:id/specs/:specId/status", async ({ params, body }) => {
    const { source, store } = await context(params.id);
    const status = String(body?.status || "deprecated");
    const { spec } = await store.setStatus(params.specId, status);
    const governance = ["adr", "rfc", "rule"].includes(spec.layer);
    await recordActivity(source.path, {
      actor: await actor(),
      kind: governance ? "governance" : "edit",
      title: `${spec.id} pasa a ${status}`,
      detail: spec.title,
      specs: [spec.id],
    });
    return { spec };
  });

  router.delete("/api/sources/:id/specs/:specId", async ({ params }) => {
    const { source, store } = await context(params.id);
    const removed = await store.remove(params.specId);
    await recordActivity(source.path, { actor: await actor(), kind: "edit", title: `Borró ${params.specId}`, detail: "La spec se ha eliminado de la base.", specs: [params.specId] });
    return { removed };
  });

  router.get("/api/sources/:id/search", async ({ params, query }) => {
    const { store } = await context(params.id);
    const index = buildSpecIndex(store.all());
    return { results: index.search(String(query.q || ""), { limit: Number(query.limit) || 20 }).map((hit) => ({ ...hit.payload, score: Number(hit.score.toFixed(2)), snippet: snippetFor(store.get(hit.id)?.body, query.q) })) };
  });

  /* ---------- Registro de gobernanza ---------- */
  router.get("/api/sources/:id/activity", async ({ params, query }) => {
    const { source } = await context(params.id);
    return listActivity(source.path, { limit: Number(query.limit) || 120, kind: query.kind || "", actor: query.actor || "", spec: query.spec || "" });
  });

  /**
   * Corrección hecha por alguien que no mantiene la base: no reescribe la spec, se anota como
   * evidencia sobre la spec más parecida y sube la versión. El experto la ve en el registro y decide.
   */
  router.post("/api/sources/:id/corrections", async ({ params, body }) => {
    const { source, store } = await context(params.id);
    const correction = String(body?.correction || "").trim();
    if (!correction) throw new HttpError(400, "Escribe la corrección.");
    const question = String(body?.question || "").trim();
    const requested = String(body?.specId || "").trim().toUpperCase();
    const match = requested || buildSpecIndex(store.all()).search(`${question} ${correction}`, { limit: 1 })[0]?.id || "";
    const target = match && store.get(match) ? match : "";
    const who = await actor();

    // Si no se identifica a qué spec afecta, la corrección no se pierde: queda en el registro como
    // pendiente de asignar para que quien mantiene la base la coloque donde toque.
    if (!target) {
      await recordActivity(source.path, { actor: who, kind: "chat", title: "Corrección sin asignar", detail: question ? `Sobre "${question}": ${correction}` : correction });
      return { spec: null, recorded: true, unassigned: true };
    }
    const note = `Corrección de ${who}${question ? ` sobre la pregunta "${question}"` : ""}: ${correction}`;
    const { spec } = await store.update(target, {}, { bump: "minor", evidenceNote: note });
    await recordActivity(source.path, { actor: who, kind: "chat", title: `Corrigió ${spec.id} desde el chat`, detail: correction, specs: [spec.id] });
    return { spec: { id: spec.id, title: spec.title, version: spec.version, layer: spec.layer }, recorded: true, unassigned: false };
  });

  /**
   * Vista llana de la base para quien no sabe qué es una spec: títulos y resúmenes, sin identificadores
   * ni capas.
   */
  router.get("/api/sources/:id/knowledge", async ({ params, query }) => {
    const { source, store } = await context(params.id);
    const specs = store.all().filter((spec) => spec.status !== "deprecated");
    const documents = await listDocuments(source.path);
    const meta = await documentsMeta(source.path);
    const items = specs
      .map((spec) => ({ id: spec.id, title: spec.title, summary: firstSentence(spec.body), updated: spec.updated || "" }))
      .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
      .slice(0, Number(query.limit) || 40);
    return {
      name: source.name,
      knows: items,
      total: specs.length,
      documents: documents.map((document) => ({ name: document.name, size: document.size, analyzed: (meta[document.name]?.specs || []).length > 0, importedBy: meta[document.name]?.importedBy || "" })),
    };
  });

  router.get("/api/sources/:id/graph", async ({ params }) => {
    const { store } = await context(params.id);
    const graph = buildGraph(store.all());
    return { ...graphView(graph), stats: graphStats(graph), orphans: orphans(graph), issues: validateGraph(graph) };
  });

  router.get("/api/sources/:id/graph/path", async ({ params, query }) => {
    const { store } = await context(params.id);
    return { path: pathBetween(buildGraph(store.all()), query.from, query.to) };
  });

  router.get("/api/sources/:id/activation/:specId", async ({ params }) => {
    const { store } = await context(params.id);
    const spec = store.get(params.specId);
    if (!spec) throw new HttpError(404, "Spec no encontrada.");
    const explicit = spec.activates?.length ? spec.activates : [spec.id];
    const bundle = activationBundle(buildGraph(store.all()), { explicitIds: explicit, layer: spec.layer });
    return { bundle, markdown: renderActivationBundle(bundle) };
  });

  /* ---------- Documentos ---------- */
  router.get("/api/sources/:id/documents", async ({ params }) => {
    const { source } = await context(params.id);
    const [documents, meta] = await Promise.all([listDocuments(source.path), documentsMeta(source.path)]);
    return { documents: documents.map((document) => ({ ...document, importedBy: meta[document.name]?.importedBy || "", importedAt: meta[document.name]?.importedAt || "", specs: meta[document.name]?.specs || [] })) };
  });

  router.post("/api/sources/:id/documents", async ({ params, body }) => {
    const { source } = await context(params.id);
    const files = Array.isArray(body?.files) ? body.files : [body];
    const saved = [];
    const who = await actor();
    for (const file of files) {
      const document = await saveDocument(source.path, { name: file.name, base64: file.base64 });
      await recordDocumentImport(source.path, document.name, who);
      saved.push({ ...document, importedBy: who });
    }
    await recordActivity(source.path, { actor: who, kind: "import", title: saved.length === 1 ? `Importó ${saved[0].name}` : `Importó ${saved.length} documentos`, detail: saved.map((item) => item.name).join(", "), documents: saved.map((item) => item.name) });
    return { documents: saved };
  });

  router.get("/api/sources/:id/documents/:name/text", async ({ params }) => {
    const { source } = await context(params.id);
    return { name: params.name, text: await getDocumentText(source.path, params.name) };
  });

  router.get("/api/sources/:id/documents/:name/download", async ({ params, res }) => {
    const { source } = await context(params.id);
    const documents = await listDocuments(source.path);
    const document = documents.find((item) => item.name === params.name);
    if (!document) throw new HttpError(404, "Documento no encontrado.");
    await sendFile(res, document.path, { download: true, name: document.name });
  });

  router.delete("/api/sources/:id/documents/:name", async ({ params }) => {
    const { source } = await context(params.id);
    const removed = await deleteDocument(source.path, params.name);
    await forgetDocument(source.path, params.name);
    await recordActivity(source.path, { actor: await actor(), kind: "import", title: `Borró ${params.name}`, detail: "Documento retirado de la base." });
    return { removed };
  });

  /* ---------- Análisis ---------- */
  router.get("/api/sources/:id/analyses", async ({ params }) => ({ analyses: await listJobs({ sourceId: params.id }) }));
  router.post("/api/sources/:id/analyze", async ({ params, body }) => startAnalysis({ sourceId: params.id, documents: body?.documents || [], userContext: body?.userContext || "", model: body?.model || "" }));
  router.get("/api/analyses/:jobId", async ({ params }) => getAnalysis(params.jobId));
  router.post("/api/analyses/:jobId/cancel", async ({ params }) => ({ cancelled: await cancelAnalysis(params.jobId) }));
  router.post("/api/analyses/:jobId/confirm", async ({ params, body }) => {
    const result = await confirmAnalysis(params.jobId, { specIds: body?.specIds });
    const job = await getAnalysis(params.jobId).catch(() => null);
    const applied = (result?.results || []).filter((item) => !item.error);
    if (job?.sourcePath && applied.length) {
      const ids = applied.map((item) => item.id);
      const created = applied.filter((item) => item.action !== "enriched" && item.action !== "evidence-only").length;
      await attachSpecsToDocuments(job.sourcePath, job.documents || [], ids);
      await recordActivity(job.sourcePath, {
        actor: await actor(),
        kind: "analysis",
        title: `Analizó ${(job.documents || []).join(", ") || "documentos"}`,
        detail: `${created} spec(s) creadas y ${applied.length - created} actualizadas: ${ids.join(", ")}`,
        specs: ids,
        documents: job.documents || [],
      });
    }
    return result;
  });
  router.post("/api/analyses/:jobId/discard", async ({ params }) => discardAnalysis(params.jobId));
  router.delete("/api/analyses/:jobId", async ({ params }) => { await deleteJob(params.jobId); return { removed: true }; });
  router.put("/api/analyses/:jobId/specs/:specId", async ({ params, body }) => updatePreviewSpec(params.jobId, params.specId, body || {}));
  router.post("/api/analyses/:jobId/questions/:questionId", async ({ params, body }) => resolvePreviewQuestion(params.jobId, params.questionId, body || {}));

  router.get("/api/sources/:id/pending", async ({ params }) => {
    const { source } = await context(params.id);
    return { pending: await readPendingTasks(source.path) };
  });
  router.delete("/api/sources/:id/pending/:taskId", async ({ params }) => {
    const { source } = await context(params.id);
    return { pending: await resolvePendingTask(source.path, params.taskId) };
  });
}

/** Primera frase útil del cuerpo de una spec, para contarla en lenguaje llano. */
function firstSentence(body) {
  const text = String(body || "")
    .replace(/^---[\s\S]*?---/, "")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#") && !line.trim().startsWith("|") && !line.trim().startsWith("```"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = text.split(/(?<=[.:])\s/)[0] || text;
  return sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence;
}

function defaultBody(layer) {
  const sections = LAYERS[layer]?.sections || ["Intent", "Definition", "Acceptance Criteria"];
  return sections.map((section) => `## ${section}\n\n`).join("\n");
}
