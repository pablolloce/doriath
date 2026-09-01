import { randomUUID, createHash } from "node:crypto";
import yaml from "js-yaml";
import { getConfig } from "../config.mjs";
import { eventBus } from "../util/events.mjs";
import { log } from "../util/log.mjs";
import { createCancellationToken } from "../util/process.mjs";
import { withSession } from "../ai/copilot.mjs";
import { loadSpecDrivenPrompt, loadVerticalTaxonomy, renderTemplate } from "../ai/prompts.mjs";
import { parseModelYaml, hasEndMarker, mergeContinuation, extractYamlBlock } from "../ai/yaml-blocks.mjs";
import { getSource, touchSource } from "./sources.mjs";
import { getSpecStore } from "../kdd/store.mjs";
import { getDocumentText } from "./documents.mjs";
import { chunkText, splitDocumentSections } from "./extract.mjs";
import { specsInventoryText, relevantSpecsText, fewShotExamplesText, decisionHistoryText, pendingTasksText, keywordQuery } from "./context.mjs";
import { saveJob, loadJob, readPendingTasks, addPendingTasks, appendAnalysisRecord, readAnalysisRecord } from "./analysis-store.mjs";
import { normalizeLayer, axisForLayer, LAYERS } from "../kdd/layout.mjs";
import { parseSpecId, buildSpecId, nextSpecNumber } from "../kdd/ids.mjs";
import { validateSpecStructure } from "../kdd/sections.mjs";

/**
 * Pipeline de análisis de documentos (mismo diseño que KDD Studio):
 *   fase 1  extracción exhaustiva de átomos por trozo de documento;
 *   fase 2a plan de curación (clasificar, fusionar, filtrar, conectar, cobertura) sin bodies;
 *   fase 2b generación de bodies por grupos de specs con rebanadas del documento.
 * Nada se persiste hasta que el usuario confirma el preview.
 */
const activeJobs = new Map(); // jobId -> { token }
const EXTRACT_CHUNK_CHARS = 60000;
const GENERATION_GROUP_SIZE = 4;
const MAX_CONTINUATIONS = 4;

function publish(job, type, data = {}) {
  eventBus.publish(`analysis:${job.id}`, type, { jobId: job.id, phase: job.phase, status: job.status, ...data });
}

async function persist(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  await saveJob(job);
  return job;
}

function pushLog(job, message) {
  job.log = [...(job.log || []), { at: new Date().toISOString(), message }].slice(-200);
  publish(job, "log", { message });
}

async function collectUntilMarker(send, firstPrompt, marker, onChunk) {
  let text = await send(firstPrompt);
  onChunk?.(text);
  let attempts = 0;
  while (!hasEndMarker(text, marker) && attempts < MAX_CONTINUATIONS) {
    attempts += 1;
    const continuation = await send(`Tu respuesta se cortó antes del marcador ${marker}. Continúa EXACTAMENTE desde donde lo dejaste: emite SOLO el YAML que falta (sin repetir lo ya emitido, sin prosa, sin fences) y termina con la línea ${marker}.`);
    text = mergeContinuation(text, continuation);
  }
  return text;
}

/* ---------- Fase 1: extracción ---------- */

async function runExtraction(job, { config, sourceId, document, text, cancellationToken }) {
  const template = await loadSpecDrivenPrompt("analyze-document-extract", { includeWorkflow: false });
  const chunks = chunkText(text, EXTRACT_CHUNK_CHARS);
  const atoms = [];
  const presuppositions = [];
  const sectionsCovered = [];
  for (let index = 0; index < chunks.length; index += 1) {
    cancellationToken.throwIfCancelled();
    pushLog(job, `Extrayendo átomos de ${document}${chunks.length > 1 ? ` (trozo ${index + 1}/${chunks.length})` : ""}…`);
    job.progress = { message: `Extracción ${document}`, current: index + 1, total: chunks.length };
    publish(job, "progress", { progress: job.progress });
    const systemMessage = renderTemplate(template, { UUAA: sourceId, DOC_NAME: document, ANALYSIS_DATE: job.analysisDate });
    const chunkNote = chunks.length > 1 ? `\n\n(Este es el trozo ${index + 1} de ${chunks.length} del documento "${document}". Numera los átomos desde A${String(atoms.length + 1).padStart(3, "0")}.)` : "";
    const result = await withSession({ config, workingDirectory: job.sourcePath, systemMessage, permissionProfile: "none", model: job.model, cancellationToken, onEvent: (event) => forwardEvent(job, event) }, async ({ send }) => {
      const output = await collectUntilMarker(send, `Documento "${document}"${chunkNote}\n\n<<<DOCUMENTO>>>\n${chunks[index]}\n<<<FIN DOCUMENTO>>>\n\nExtrae los átomos y emite el bloque YAML empezando por \`extraction:\`.`, "#END_OF_EXTRACTION");
      return output;
    });
    accumulateUsage(job, result.usage);
    const parsed = parseModelYaml(result.output, { startKey: "extraction", endMarker: "#END_OF_EXTRACTION" });
    const chunkAtoms = Array.isArray(parsed.atoms) ? parsed.atoms : [];
    for (const atom of chunkAtoms) {
      if (!atom || typeof atom !== "object") continue;
      const id = `A${String(atoms.length + 1).padStart(3, "0")}`;
      atoms.push({
        id,
        originalId: String(atom.id || id),
        document,
        section: String(atom.section || ""),
        title: String(atom.title || ""),
        content: String(atom.content || "").trim(),
        signals: Array.isArray(atom.signals) ? atom.signals.map(String) : [],
        appearsAlsoIn: Array.isArray(atom.appears_also_in) ? atom.appears_also_in.map(String) : [],
      });
    }
    for (const item of Array.isArray(parsed.presuppositions) ? parsed.presuppositions : []) {
      if (item?.statement) presuppositions.push({ id: `P${String(presuppositions.length + 1).padStart(3, "0")}`, document, statement: String(item.statement), candidateType: String(item.candidate_type || "depends-on") });
    }
    for (const section of Array.isArray(parsed.extraction?.sections_covered) ? parsed.extraction.sections_covered : []) {
      if (section?.section) sectionsCovered.push({ document, section: String(section.section), status: String(section.status || "covered"), atoms: (section.atoms || []).map(String), reason: section.reason ? String(section.reason) : "" });
    }
  }
  return { atoms, presuppositions, sectionsCovered };
}

function forwardEvent(job, event) {
  if (event.type === "tool" || event.type === "error") publish(job, "model", event);
}

function accumulateUsage(job, usage) {
  if (!usage) return;
  const total = job.usage || { inputTokens: 0, outputTokens: 0, premiumRequests: 0, models: [] };
  total.inputTokens += Number(usage.inputTokens || 0);
  total.outputTokens += Number(usage.outputTokens || 0);
  total.premiumRequests += Number(usage.premiumRequests || 0);
  total.models = [...new Set([...(total.models || []), ...(usage.models || [])])];
  job.usage = total;
}

/* ---------- Fase 2a: plan ---------- */

function atomsListYaml(atoms) {
  return yaml.dump(atoms.map((atom) => ({ id: atom.id, document: atom.document, section: atom.section, title: atom.title, content: atom.content, signals: atom.signals })), { lineWidth: 100, noRefs: true });
}

function sectionsCoveredText(sections) {
  if (!sections.length) return "(la fase 1 no reportó cobertura por secciones)";
  return sections.map((section) => `- ${section.document} · ${section.section}: ${section.status}${section.atoms.length ? ` (${section.atoms.join(", ")})` : ""}${section.reason ? ` — ${section.reason}` : ""}`).join("\n");
}

const TYPE_TO_LAYER = { adr: "adr", rfc: "rfc", rule: "rule" };

function normalizePlanSpec(raw, index) {
  const type = String(raw.type || "").toLowerCase();
  let layer = normalizeLayer(raw.layer) || TYPE_TO_LAYER[type] || null;
  if (!layer && raw.id) layer = parseSpecId(String(raw.id))?.layer || null;
  const action = ["create", "enrich", "skip"].includes(String(raw.action || "").toLowerCase()) ? String(raw.action).toLowerCase() : "create";
  return {
    key: `spec-${index + 1}`,
    id: String(raw.id || "").toUpperCase().trim(),
    action,
    targetId: raw.target_id ? String(raw.target_id).toUpperCase() : "",
    layer,
    axis: layer ? axisForLayer(layer) : null,
    title: String(raw.title || raw.id || "").trim(),
    domain: raw.domain ? String(raw.domain) : "",
    subdomain: raw.subdomain ? String(raw.subdomain) : "",
    status: raw.status ? String(raw.status).toLowerCase() : "",
    confidence: raw.confidence ? String(raw.confidence).toLowerCase() : "low",
    version: raw.version ? String(raw.version) : "1.0.0",
    owner: raw.owner ? String(raw.owner) : "pending",
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.filter((dep) => dep && (dep.id || typeof dep === "string")).map((dep) => (typeof dep === "string" ? { id: dep.toUpperCase(), type: "depends-on" } : { id: String(dep.id).toUpperCase(), type: String(dep.relation || dep.type || "depends-on").toLowerCase() })) : [],
    activates: Array.isArray(raw.activates) ? raw.activates.map((id) => String(id).toUpperCase()) : [],
    parent: raw.parent ? String(raw.parent).toUpperCase() : "",
    atomIds: Array.isArray(raw.atom_ids) ? raw.atom_ids.map(String) : [],
    reasoning: String(raw.reasoning || "").trim(),
    body: "",
    selected: action !== "skip",
  };
}

const DEFAULT_STATUS = { adr: "proposed", rfc: "draft", rule: "active" };

/**
 * Garantiza que cada id del plan lleva el Source ID antes del número y no colisiona con el inventario
 * ni con otros ids del propio plan. Devuelve los renombrados para trazabilidad.
 */
function normalizePlanIds(specs, existingIds, sourceId) {
  const taken = new Set(existingIds);
  const renames = [];
  const upperSource = String(sourceId).toUpperCase();
  for (const spec of specs) {
    if (!spec.layer) continue;
    if (spec.action !== "create") continue;
    const parsed = parseSpecId(spec.id);
    let domain = parsed?.domain || "";
    if (parsed?.sourceId && parsed.sourceId !== upperSource) domain = [domain, parsed.sourceId].filter(Boolean).join("-");
    if (parsed && !parsed.sourceId && parsed.domain) {
      const segments = parsed.domain.split("-");
      if (segments.length > 1) domain = segments.slice(0, -1).join("-");
      else domain = parsed.domain;
    }
    let number = parsed?.number || 0;
    const wantedId = parsed && parsed.sourceId === upperSource ? spec.id : buildSpecId({ layer: spec.layer, domain, sourceId: upperSource, number: number || nextSpecNumber([...taken], { layer: spec.layer, domain, sourceId: upperSource }) });
    let finalId = wantedId;
    if (taken.has(finalId)) {
      finalId = buildSpecId({ layer: spec.layer, domain, sourceId: upperSource, number: nextSpecNumber([...taken], { layer: spec.layer, domain, sourceId: upperSource }) });
    }
    if (finalId !== spec.id) {
      renames.push({ from: spec.id, to: finalId });
      spec.id = finalId;
    }
    taken.add(finalId);
  }
  const renameMap = new Map(renames.map((item) => [item.from, item.to]));
  for (const spec of specs) {
    spec.dependencies = spec.dependencies.map((dep) => ({ ...dep, id: renameMap.get(dep.id) || dep.id }));
    spec.activates = spec.activates.map((id) => renameMap.get(id) || id);
    if (spec.parent) spec.parent = renameMap.get(spec.parent) || spec.parent;
  }
  return renames;
}

async function runPlan(job, { config, source, store, atoms, sectionsCovered, userContext, documentText, cancellationToken }) {
  pushLog(job, "Planificando specs (clasificación, fusión, filtro, dependencias, cobertura)…");
  job.progress = { message: "Plan de curación", current: 1, total: 1 };
  publish(job, "progress", { progress: job.progress });
  const template = await loadSpecDrivenPrompt("analyze-document-plan");
  const specs = store.all();
  const query = keywordQuery(documentText);
  const [vertical, fewShot, decisions, pending] = await Promise.all([
    loadVerticalTaxonomy("cib-taxonomy"),
    fewShotExamplesText(query),
    store.readDecisionHistory(),
    readPendingTasks(source.path),
  ]);
  const previousRecords = [];
  for (const document of job.documents) {
    const record = await readAnalysisRecord(source.path, document);
    if (record) previousRecords.push(`- ${document} (${record.at?.slice(0, 10)}): ${record.summary || ""} → specs ${record.specIds?.join(", ") || "ninguna"}`);
  }
  const systemMessage = renderTemplate(template, {
    UUAA: source.sourceId,
    DOC_NAME: job.documents.join(" + "),
    ANALYSIS_DATE: job.analysisDate,
    VERTICAL_TAXONOMY: vertical || "(sin taxonomía vertical declarada)",
    FEW_SHOT_EXAMPLES: fewShot,
    SPECS_INVENTORY: specsInventoryText(specs),
    RELEVANT_EXISTING_SPECS: relevantSpecsText(specs, query),
    PREVIOUS_ANALYSIS: previousRecords.length ? previousRecords.join("\n") : "(sin análisis previo de este documento)",
    DECISION_HISTORY: decisionHistoryText(decisions),
    PENDING_TASKS: pendingTasksText(pending),
    USER_CONTEXT: userContext?.trim() || "(sin contexto adicional del operador)",
    SECTIONS_COVERED: sectionsCoveredText(sectionsCovered),
    ATOMS_LIST: atomsListYaml(atoms),
  });
  const result = await withSession({ config, workingDirectory: source.path, systemMessage, permissionProfile: "none", model: job.model, cancellationToken, onEvent: (event) => forwardEvent(job, event) }, async ({ send }) => collectUntilMarker(send, "Aplica las 5 etapas de curación sobre la lista de átomos y emite el bloque YAML del plan empezando por `plan:`.", "#END_OF_PLAN"));
  accumulateUsage(job, result.usage);
  const parsed = parseModelYaml(result.output, { startKey: "plan", endMarker: "#END_OF_PLAN" });
  const rawSpecs = Array.isArray(parsed.specs) ? parsed.specs : [];
  const planSpecs = rawSpecs.map(normalizePlanSpec).filter((spec) => spec.layer && spec.id);
  const warnings = [];
  const existingIds = store.ids();
  for (const spec of planSpecs) {
    if (spec.action !== "create") {
      if (!existingIds.includes(spec.targetId || spec.id)) {
        warnings.push(`${spec.id}: el plan quería enriquecer ${spec.targetId || spec.id}, que no existe; se tratará como spec nueva.`);
        spec.action = "create";
        spec.targetId = "";
      } else {
        spec.targetId = spec.targetId || spec.id;
        spec.id = spec.targetId;
      }
    }
    if (!spec.status) spec.status = DEFAULT_STATUS[spec.layer] || "draft";
  }
  const renames = normalizePlanIds(planSpecs, existingIds, source.sourceId);
  for (const rename of renames) warnings.push(`Identificador ajustado al patrón de la caja: ${rename.from} → ${rename.to}.`);
  const known = new Set([...existingIds, ...planSpecs.map((spec) => spec.id)]);
  for (const spec of planSpecs) {
    const before = spec.dependencies.length;
    spec.dependencies = spec.dependencies.filter((dep) => known.has(dep.id));
    if (spec.dependencies.length !== before) warnings.push(`${spec.id}: se han descartado dependencias hacia specs inexistentes.`);
    spec.activates = spec.activates.filter((id) => known.has(id));
  }
  const discarded = (Array.isArray(parsed.discarded_atoms) ? parsed.discarded_atoms : []).map((item) => ({ atomId: String(item?.atom_id || ""), summary: String(item?.summary || ""), stage: String(item?.stage || "filter"), reason: String(item?.reason || "") }));
  const covered = new Set([...planSpecs.flatMap((spec) => spec.atomIds), ...discarded.map((item) => item.atomId)]);
  const unassigned = atoms.filter((atom) => !covered.has(atom.id)).map((atom) => atom.id);
  if (unassigned.length) warnings.push(`Átomos sin asignar a ninguna spec ni descartados: ${unassigned.join(", ")}.`);
  const toEntries = (items, kind) => (Array.isArray(items) ? items : []).filter(Boolean).map((text) => ({ id: `${kind === "conflict" ? "cf" : "oq"}-${createHash("sha1").update(String(text)).digest("hex").slice(0, 6)}`, kind, text: String(text), resolved: false, resolution: "" }));
  return {
    summary: String(parsed.plan?.summary || ""),
    specs: planSpecs,
    discarded,
    conflicts: toEntries(parsed.conflicts, "conflict"),
    openQuestions: toEntries(parsed.open_questions, "question"),
    modelWarnings: (Array.isArray(parsed.warnings) ? parsed.warnings : []).map(String),
    coverage: { totalAtoms: atoms.length, covered: planSpecs.flatMap((spec) => spec.atomIds).length, discarded: discarded.length, unassigned, gaps: (Array.isArray(parsed.coverage?.gaps_detected) ? parsed.coverage.gaps_detected : []).map(String) },
    warnings,
  };
}

/* ---------- Fase 2b: generación ---------- */

function sectionsForAtoms(atoms, sectionsByDocument, maxChars = 24000) {
  const wanted = new Map();
  for (const atom of atoms) {
    const key = `${atom.document}::${atom.section}`;
    if (wanted.has(key)) continue;
    const sections = sectionsByDocument.get(atom.document) || [];
    const needle = atom.section.replace(/^§\s*/, "").toLowerCase().trim();
    const match = sections.find((section) => needle && (section.title.toLowerCase().includes(needle) || needle.includes(section.title.toLowerCase())));
    if (match) wanted.set(key, `§ ${atom.document} · ${match.title}\n${match.text}`);
  }
  let total = 0;
  const out = [];
  for (const slice of wanted.values()) {
    if (total + slice.length > maxChars) {
      out.push(`${slice.slice(0, Math.max(0, maxChars - total))}\n…(rebanada truncada)`);
      break;
    }
    out.push(slice);
    total += slice.length;
  }
  return out.length ? out.join("\n\n") : "(sin rebanadas disponibles: apóyate en el contenido de los átomos)";
}

async function runGeneration(job, { config, source, store, plan, atoms, documentTexts, cancellationToken }) {
  const template = await loadSpecDrivenPrompt("analyze-document-generate", { includeWorkflow: false });
  const sectionsByDocument = new Map(job.documents.map((name) => [name, splitDocumentSections(documentTexts[name] || "")]));
  const targets = plan.specs.filter((spec) => spec.action !== "skip");
  const groups = [];
  for (let index = 0; index < targets.length; index += GENERATION_GROUP_SIZE) groups.push(targets.slice(index, index + GENERATION_GROUP_SIZE));
  const neighbourhood = plan.specs.map((spec) => `- ${spec.id}: ${spec.title}`).join("\n") || "(sin vecindario)";
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const gaps = [];
  let done = 0;
  const runGroup = async (group, groupIndex) => {
    cancellationToken.throwIfCancelled();
    pushLog(job, `Redactando bodies del grupo ${groupIndex + 1}/${groups.length} (${group.map((spec) => spec.id).join(", ")})…`);
    const groupAtoms = group.flatMap((spec) => spec.atomIds.map((id) => atomById.get(id)).filter(Boolean));
    const enrichBodies = group.filter((spec) => spec.action === "enrich").map((spec) => {
      const existing = store.get(spec.targetId || spec.id);
      return existing ? `### ${existing.id}\n\n${existing.body}` : "";
    }).filter(Boolean).join("\n\n") || "(ninguna spec del grupo es de enriquecimiento)";
    const systemMessage = renderTemplate(template, {
      UUAA: source.sourceId,
      DOC_NAME: job.documents.join(" + "),
      ANALYSIS_DATE: job.analysisDate,
      GROUP_SPECS: yaml.dump(group.map((spec) => ({ id: spec.id, action: spec.action, target_id: spec.targetId || null, type: spec.axis === "governance" ? spec.layer : spec.axis, layer: spec.layer, title: spec.title, domain: spec.domain, subdomain: spec.subdomain, status: spec.status, confidence: spec.confidence, version: spec.version, owner: spec.owner, tags: spec.tags, dependencies: spec.dependencies.map((dep) => ({ id: dep.id, relation: dep.type })), activates: spec.activates, parent: spec.parent || null, atom_ids: spec.atomIds, reasoning: spec.reasoning })), { lineWidth: 100, noRefs: true }),
      GROUP_ATOMS: groupAtoms.length ? yaml.dump(groupAtoms.map((atom) => ({ id: atom.id, section: atom.section, title: atom.title, content: atom.content })), { lineWidth: 100, noRefs: true }) : "(el plan no asignó átomos a este grupo)",
      DOC_SLICES: sectionsForAtoms(groupAtoms, sectionsByDocument),
      ENRICH_BODIES: enrichBodies,
      PLAN_NEIGHBORHOOD: neighbourhood,
    });
    const result = await withSession({ config, workingDirectory: source.path, systemMessage, permissionProfile: "none", model: job.model, cancellationToken, onEvent: (event) => forwardEvent(job, event) }, async ({ send }) => collectUntilMarker(send, `Redacta el body de las specs del grupo (${group.map((spec) => spec.id).join(", ")}) y emite el bloque YAML empezando por \`generation:\`.`, "#END_OF_GENERATION"));
    accumulateUsage(job, result.usage);
    const parsed = parseModelYaml(result.output, { startKey: "generation", endMarker: "#END_OF_GENERATION" });
    const bodies = new Map((Array.isArray(parsed.generation?.specs) ? parsed.generation.specs : []).map((item) => [String(item?.id || "").toUpperCase(), String(item?.body || "")]));
    for (const spec of group) {
      const body = bodies.get(spec.id) || bodies.get(spec.targetId) || "";
      if (!body.trim()) {
        gaps.push(`${spec.id}: el modelo no devolvió body; se usará el contenido de sus átomos.`);
        spec.body = spec.atomIds.map((id) => atomById.get(id)?.content || "").filter(Boolean).join("\n\n");
      } else {
        spec.body = body.trim();
      }
    }
    for (const gap of Array.isArray(parsed.generation?.group_gaps_detected) ? parsed.generation.group_gaps_detected : []) gaps.push(String(gap));
    done += 1;
    job.progress = { message: "Generación de bodies", current: done, total: groups.length };
    publish(job, "progress", { progress: job.progress });
  };
  const concurrency = 2;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, async () => {
    while (cursor < groups.length) {
      const index = cursor;
      cursor += 1;
      await runGroup(groups[index], index);
    }
  }));
  return { gaps };
}

/* ---------- Preview ---------- */

function previewSpec(spec, store) {
  const draft = {
    id: spec.id,
    layer: spec.layer,
    axis: spec.axis,
    type: spec.axis,
    title: spec.title,
    status: spec.status,
    confidence: spec.confidence,
    version: spec.version,
    owner: spec.owner,
    domain: spec.domain,
    subdomain: spec.subdomain,
    tags: spec.tags,
    dependencies: spec.dependencies,
    activates: spec.activates,
    parent: spec.parent,
    body: spec.body,
  };
  const issues = validateSpecStructure(draft);
  const existing = spec.action === "enrich" ? store.get(spec.targetId || spec.id) : null;
  return {
    ...spec,
    issues,
    blocking: issues.some((issue) => issue.severity === "error"),
    existing: existing ? { confidence: existing.confidence, manualEdits: existing.manualEdits, version: existing.version, protected: existing.confidence !== "low" || existing.manualEdits } : null,
  };
}

function rebuildPreview(job, store) {
  job.preview.specs = job.preview.specs.map((spec) => previewSpec(spec, store));
  return job.preview;
}

/* ---------- Orquestación ---------- */

export async function startAnalysis({ sourceId, documents, userContext = "", model }) {
  const config = getConfig();
  const source = await getSource(sourceId);
  await touchSource(sourceId);
  if (!Array.isArray(documents) || !documents.length) throw Object.assign(new Error("Selecciona al menos un documento."), { status: 400 });
  const job = {
    id: randomUUID(),
    sourceId,
    sourcePath: source.path,
    sourceCode: source.sourceId,
    documents,
    userContext,
    model: model || "",
    status: "running",
    phase: "extracting",
    progress: { message: "Preparando", current: 0, total: 0 },
    analysisDate: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    log: [],
    usage: null,
    preview: null,
    error: "",
  };
  await persist(job);
  const token = createCancellationToken();
  activeJobs.set(job.id, { token });
  runJob(job, { config, source, token }).catch((error) => {
    log.error("analyzer", `Análisis ${job.id} fallido: ${error.stack || error.message}`);
  }).finally(() => activeJobs.delete(job.id));
  return job;
}

async function runJob(job, { config, source, token }) {
  try {
    const store = await getSpecStore(source.path).load({ force: true });
    const documentTexts = {};
    for (const name of job.documents) {
      const text = await getDocumentText(source.path, name);
      if (!text.trim()) throw new Error(`El documento ${name} no tiene texto extraíble.`);
      documentTexts[name] = text;
    }
    const atoms = [];
    const presuppositions = [];
    const sectionsCovered = [];
    for (const name of job.documents) {
      const extracted = await runExtraction(job, { config, sourceId: source.sourceId, document: name, text: documentTexts[name], cancellationToken: token });
      for (const atom of extracted.atoms) atoms.push({ ...atom, id: `A${String(atoms.length + 1).padStart(3, "0")}` });
      presuppositions.push(...extracted.presuppositions);
      sectionsCovered.push(...extracted.sectionsCovered);
      await persist(job, { extraction: { atoms, presuppositions, sectionsCovered } });
    }
    if (!atoms.length) throw new Error("La extracción no produjo átomos de conocimiento. Revisa que el documento tenga contenido textual.");
    pushLog(job, `${atoms.length} átomos extraídos.`);
    await persist(job, { phase: "planning" });
    const plan = await runPlan(job, { config, source, store, atoms, sectionsCovered, userContext: job.userContext, documentText: Object.values(documentTexts).join("\n\n"), cancellationToken: token });
    pushLog(job, `Plan: ${plan.specs.length} specs, ${plan.discarded.length} átomos descartados.`);
    await persist(job, { phase: "generating", plan: { summary: plan.summary, coverage: plan.coverage } });
    const generation = plan.specs.length ? await runGeneration(job, { config, source, store, plan, atoms, documentTexts, cancellationToken: token }) : { gaps: [] };
    job.preview = {
      summary: plan.summary,
      specs: plan.specs.map((spec) => previewSpec(spec, store)),
      discarded: plan.discarded,
      conflicts: plan.conflicts,
      openQuestions: plan.openQuestions,
      presuppositions,
      warnings: [...plan.warnings, ...plan.modelWarnings, ...generation.gaps],
      coverage: plan.coverage,
      persistedModifications: [],
    };
    pushLog(job, "Preview listo. Revisa las specs y confirma cuáles persistir.");
    await persist(job, { status: "preview", phase: "preview", progress: { message: "Preview", current: 1, total: 1 } });
    publish(job, "done", { specCount: job.preview.specs.length });
  } catch (error) {
    const cancelled = error.code === "CANCELLED";
    await persist(job, { status: cancelled ? "cancelled" : "failed", error: cancelled ? "Análisis cancelado." : error.message });
    publish(job, cancelled ? "cancelled" : "failed", { error: job.error });
  }
}

export async function cancelAnalysis(jobId) {
  const active = activeJobs.get(jobId);
  if (!active) return false;
  active.token.cancel();
  return true;
}

export async function getAnalysis(jobId) {
  return loadJob(jobId);
}

export async function updatePreviewSpec(jobId, specId, patch) {
  const job = await loadJob(jobId);
  if (job.status !== "preview") throw Object.assign(new Error("El análisis no está en fase de preview."), { status: 409 });
  const store = await getSpecStore(job.sourcePath).load();
  const spec = job.preview.specs.find((item) => item.id === specId || item.key === specId);
  if (!spec) throw Object.assign(new Error(`La spec ${specId} no está en el preview.`), { status: 404 });
  for (const key of ["title", "body", "status", "confidence", "owner", "domain", "subdomain", "tags", "dependencies", "activates", "parent", "selected", "reasoning"]) {
    if (patch[key] !== undefined) spec[key] = patch[key];
  }
  if (patch.id && patch.id !== spec.id) {
    const newId = String(patch.id).toUpperCase();
    if (!parseSpecId(newId)) throw Object.assign(new Error("Identificador no válido."), { status: 400 });
    if (store.get(newId) || job.preview.specs.some((item) => item.id === newId)) throw Object.assign(new Error("Ese identificador ya existe."), { status: 409 });
    spec.id = newId;
  }
  rebuildPreview(job, store);
  await persist(job);
  publish(job, "preview-updated", { specId: spec.id });
  return job;
}

export async function resolvePreviewQuestion(jobId, questionId, { resolution, resolved = true }) {
  const job = await loadJob(jobId);
  const entry = [...(job.preview?.openQuestions || []), ...(job.preview?.conflicts || [])].find((item) => item.id === questionId);
  if (!entry) throw Object.assign(new Error("Pregunta no encontrada."), { status: 404 });
  entry.resolved = Boolean(resolved);
  entry.resolution = String(resolution || "");
  await persist(job);
  publish(job, "preview-updated", { questionId });
  return job;
}

/**
 * Aplica acciones del chat de resolución (mismo contrato que KDD Studio) sobre el preview.
 */
export async function applyResolutionActions(jobId, actions) {
  const job = await loadJob(jobId);
  if (!job.preview) throw Object.assign(new Error("El análisis no tiene preview."), { status: 409 });
  const store = await getSpecStore(job.sourcePath).load();
  const applied = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    const type = String(action?.action_type || "");
    if (type === "propose_modification") {
      for (const item of Array.isArray(action.specs) ? action.specs : []) {
        const spec = job.preview.specs.find((entry) => entry.id === String(item.id || "").toUpperCase());
        if (!spec) continue;
        if (item.body) spec.body = String(item.body);
        if (item.title) spec.title = String(item.title);
        if (Array.isArray(item.dependencies)) spec.dependencies = item.dependencies.map((dep) => ({ id: String(dep.id).toUpperCase(), type: String(dep.relation || dep.type || "depends-on") }));
        applied.push({ type, id: spec.id });
      }
    } else if (type === "propose_new_spec" && action.spec?.id) {
      const raw = action.spec;
      const spec = normalizePlanSpec({ ...raw, action: "create", atom_ids: [], reasoning: action.reasoning || raw.reasoning || "Propuesta del chat de resolución." }, job.preview.specs.length);
      spec.body = String(raw.body || "");
      if (!spec.status) spec.status = DEFAULT_STATUS[spec.layer] || "draft";
      normalizePlanIds([spec], [...store.ids(), ...job.preview.specs.map((entry) => entry.id)], job.sourceCode);
      job.preview.specs.push(spec);
      applied.push({ type, id: spec.id });
    } else if (type === "propose_persisted_modification") {
      for (const item of Array.isArray(action.specs) ? action.specs : []) {
        const id = String(item.id || "").toUpperCase();
        if (!store.get(id)) continue;
        job.preview.persistedModifications = (job.preview.persistedModifications || []).filter((entry) => entry.id !== id);
        job.preview.persistedModifications.push({ id, body: item.body ? String(item.body) : "", title: item.title ? String(item.title) : "", dependencies: Array.isArray(item.dependencies) ? item.dependencies.map((dep) => ({ id: String(dep.id).toUpperCase(), type: String(dep.relation || dep.type || "depends-on") })) : null, reasoning: String(item.reasoning || "") });
        applied.push({ type, id });
      }
    } else if (type === "resolve_question") {
      const entry = [...job.preview.openQuestions, ...job.preview.conflicts].find((item) => item.id === String(action.question_id || ""));
      if (entry) {
        entry.resolved = true;
        entry.resolution = String(action.resolution || "");
        entry.affectedSpecIds = Array.isArray(action.affected_spec_ids) ? action.affected_spec_ids.map(String) : [];
        applied.push({ type, id: entry.id });
      }
    } else if (type === "remove_dependency") {
      const id = String(action.spec_id || action.id || "").toUpperCase();
      const target = String(action.target_id || action.dependency_id || "").toUpperCase();
      const spec = job.preview.specs.find((entry) => entry.id === id);
      if (spec) {
        spec.dependencies = spec.dependencies.filter((dep) => dep.id !== target);
        applied.push({ type, id });
      }
    } else if (type === "deprecate_spec") {
      const id = String(action.spec_id || action.id || "").toUpperCase();
      const reactivate = Boolean(action.reactivate);
      if (store.get(id)) {
        job.preview.persistedModifications = (job.preview.persistedModifications || []).filter((entry) => entry.id !== id);
        job.preview.persistedModifications.push({ id, status: reactivate ? "active" : "deprecated", reasoning: String(action.reasoning || "") });
        applied.push({ type, id });
      }
    }
  }
  rebuildPreview(job, store);
  await persist(job);
  publish(job, "preview-updated", { applied });
  return { job, applied };
}

/** Persiste las specs seleccionadas del preview y cierra el análisis. */
export async function confirmAnalysis(jobId, { specIds } = {}) {
  const job = await loadJob(jobId);
  if (job.status !== "preview") throw Object.assign(new Error("El análisis no está en fase de preview."), { status: 409 });
  const store = await getSpecStore(job.sourcePath).load({ force: true });
  const chosen = job.preview.specs.filter((spec) => (Array.isArray(specIds) ? specIds.includes(spec.id) : spec.selected) && spec.action !== "skip");
  const results = [];
  const packageIds = new Set([...store.ids(), ...chosen.map((spec) => spec.id)]);
  for (const spec of chosen) {
    const dependencies = spec.dependencies.filter((dep) => packageIds.has(dep.id));
    const activates = spec.activates.filter((id) => packageIds.has(id));
    try {
      if (spec.action === "enrich") {
        const { spec: saved, protected: wasProtected } = await store.update(spec.targetId || spec.id, {
          body: spec.body,
          title: spec.title || undefined,
          tags: spec.tags?.length ? [...new Set([...(store.get(spec.targetId || spec.id)?.tags || []), ...spec.tags])] : undefined,
          dependencies: dependencies.length ? mergeDependencies(store.get(spec.targetId || spec.id)?.dependencies || [], dependencies) : undefined,
        }, { protectValidated: true, bump: "minor", evidenceNote: `Enriquecida desde el análisis de ${job.documents.join(", ")} (${job.analysisDate}).` });
        results.push({ id: saved.id, action: wasProtected ? "evidence-only" : "enriched", version: saved.version });
      } else {
        const saved = await store.create({
          id: spec.id,
          layer: spec.layer,
          axis: spec.axis,
          type: spec.axis,
          title: spec.title,
          status: spec.status || "draft",
          confidence: spec.confidence || "low",
          version: spec.version || "1.0.0",
          owner: spec.owner || "pending",
          domain: spec.domain,
          subdomain: spec.subdomain,
          tags: spec.tags,
          dependencies,
          activates,
          parent: spec.parent,
          source: job.sourceCode,
          body: spec.body,
        }, { generatedBy: `doriath-analyzer (${job.documents.join(", ")})` });
        results.push({ id: saved.id, action: "created", version: saved.version });
      }
    } catch (error) {
      results.push({ id: spec.id, action: "error", error: error.message });
    }
  }
  for (const modification of job.preview.persistedModifications || []) {
    try {
      if (modification.status) {
        await store.setStatus(modification.id, modification.status);
        results.push({ id: modification.id, action: modification.status });
      } else {
        const { spec: saved, protected: wasProtected } = await store.update(modification.id, {
          body: modification.body || undefined,
          title: modification.title || undefined,
          dependencies: modification.dependencies || undefined,
        }, { protectValidated: true, bump: "minor", evidenceNote: `Modificación propuesta en el chat de resolución (${job.analysisDate}): ${modification.reasoning || ""}` });
        results.push({ id: saved.id, action: wasProtected ? "evidence-only" : "modified", version: saved.version });
      }
    } catch (error) {
      results.push({ id: modification.id, action: "error", error: error.message });
    }
  }
  const resolved = [...job.preview.openQuestions, ...job.preview.conflicts].filter((item) => item.resolved);
  if (resolved.length) await store.appendDecisions(resolved.map((item) => ({ question: item.text, resolution: item.resolution, specIds: item.affectedSpecIds || [], document: job.documents.join(", ") })));
  const pending = [...job.preview.openQuestions, ...job.preview.conflicts].filter((item) => !item.resolved);
  if (pending.length) await addPendingTasks(job.sourcePath, pending.map((item) => ({ id: item.id, kind: item.kind, text: item.text, document: job.documents.join(", ") })));
  await appendAnalysisRecord(job.sourcePath, { at: new Date().toISOString(), document: job.documents.join(", "), summary: job.preview.summary, specIds: results.filter((item) => item.action !== "error").map((item) => item.id), jobId: job.id });
  await persist(job, { status: "confirmed", phase: "confirmed", results });
  publish(job, "confirmed", { results });
  return { job, results };
}

function mergeDependencies(existing, incoming) {
  const out = [...existing];
  for (const dep of incoming) if (!out.some((item) => item.id === dep.id && item.type === dep.type)) out.push(dep);
  return out;
}

export async function discardAnalysis(jobId) {
  const job = await loadJob(jobId);
  await cancelAnalysis(jobId);
  await persist(job, { status: "discarded", phase: "discarded" });
  publish(job, "discarded");
  return job;
}

export function isAnalysisRunning(jobId) {
  return activeJobs.has(jobId);
}

export { extractYamlBlock };
