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

async function context(id) {
  const source = await getSource(id);
  const store = await getSpecStore(source.path).load();
  return { source, store };
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
    return { spec };
  });

  router.put("/api/sources/:id/specs/:specId", async ({ params, body }) => {
    const { store } = await context(params.id);
    const { spec } = await store.update(params.specId, body || {}, { manual: true, bump: body?.bump === undefined ? "patch" : body.bump });
    return { spec, issues: validateSpecStructure(spec) };
  });

  router.post("/api/sources/:id/specs/:specId/status", async ({ params, body }) => {
    const { store } = await context(params.id);
    const { spec } = await store.setStatus(params.specId, String(body?.status || "deprecated"));
    return { spec };
  });

  router.delete("/api/sources/:id/specs/:specId", async ({ params }) => {
    const { store } = await context(params.id);
    return { removed: await store.remove(params.specId) };
  });

  router.get("/api/sources/:id/search", async ({ params, query }) => {
    const { store } = await context(params.id);
    const index = buildSpecIndex(store.all());
    return { results: index.search(String(query.q || ""), { limit: Number(query.limit) || 20 }).map((hit) => ({ ...hit.payload, score: Number(hit.score.toFixed(2)), snippet: snippetFor(store.get(hit.id)?.body, query.q) })) };
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
    return { documents: await listDocuments(source.path) };
  });

  router.post("/api/sources/:id/documents", async ({ params, body }) => {
    const { source } = await context(params.id);
    const files = Array.isArray(body?.files) ? body.files : [body];
    const saved = [];
    for (const file of files) saved.push(await saveDocument(source.path, { name: file.name, base64: file.base64 }));
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
    return { removed: await deleteDocument(source.path, params.name) };
  });

  /* ---------- Análisis ---------- */
  router.get("/api/sources/:id/analyses", async ({ params }) => ({ analyses: await listJobs({ sourceId: params.id }) }));
  router.post("/api/sources/:id/analyze", async ({ params, body }) => startAnalysis({ sourceId: params.id, documents: body?.documents || [], userContext: body?.userContext || "", model: body?.model || "" }));
  router.get("/api/analyses/:jobId", async ({ params }) => getAnalysis(params.jobId));
  router.post("/api/analyses/:jobId/cancel", async ({ params }) => ({ cancelled: await cancelAnalysis(params.jobId) }));
  router.post("/api/analyses/:jobId/confirm", async ({ params, body }) => confirmAnalysis(params.jobId, { specIds: body?.specIds }));
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

function defaultBody(layer) {
  const sections = LAYERS[layer]?.sections || ["Intent", "Definition", "Acceptance Criteria"];
  return sections.map((section) => `## ${section}\n\n`).join("\n");
}
