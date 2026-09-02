import { createHash } from "node:crypto";
import { parseModelYaml, extractYamlBlock } from "../ai/yaml-blocks.mjs";
import { normalizeLayer, axisForLayer, LAYERS } from "../kdd/layout.mjs";
import { parseSpecId, buildSpecId, nextSpecNumber } from "../kdd/ids.mjs";
import { validateSpecStructure } from "../kdd/sections.mjs";

/**
 * Paquetes de specs propuestos por los chats de creación (Work y Knowledge): se extraen del bloque
 * `#RESOLUTION_ACTIONS`, se normalizan, se validan con el rubric KDD y se persisten solo cuando el
 * usuario confirma. Un paquete Work es atómico: si una spec bloquea, se retiene el paquete entero.
 */
export const PHASE_MARKER = /^#CREATION_PHASE:\s*(understand|classify|validate|generate)\s*$/im;
export const SOURCE_MARKER = /^#CREATION_SOURCE_ID:\s*([A-Za-z0-9_-]+)\s*$/im;
export const REPOS_MARKER = /^#REPOSITORIES:\s*(.*)$/im;
export const ACTIONS_MARKER = "#RESOLUTION_ACTIONS";

export function splitNarrativeAndActions(text) {
  const source = String(text || "");
  const index = source.indexOf(ACTIONS_MARKER);
  const narrativeRaw = index >= 0 ? source.slice(0, index) : source;
  const narrative = narrativeRaw
    .replace(PHASE_MARKER, "")
    .replace(SOURCE_MARKER, "")
    .replace(REPOS_MARKER, "")
    .replace(/^\s*```\s*$/gm, "")
    .trim();
  const phase = PHASE_MARKER.exec(source)?.[1]?.toLowerCase() || "";
  const sourceId = SOURCE_MARKER.exec(source)?.[1] || "";
  const repositories = (REPOS_MARKER.exec(source)?.[1] || "").split(/[,;]/).map((item) => item.trim()).filter((item) => item && item.toLowerCase() !== "ninguno");
  let actions = null;
  if (index >= 0) {
    const block = extractYamlBlock(source.slice(index + ACTIONS_MARKER.length), { startKey: "actions" });
    if (block) {
      try {
        actions = parseModelYaml(block, { startKey: "actions" }).actions;
      } catch (error) {
        actions = { error: error.message };
      }
    }
  }
  return { narrative, phase, sourceId, repositories, actions };
}

const TYPE_TO_LAYER = { adr: "adr", rfc: "rfc", rule: "rule" };
const DEFAULT_STATUS = { adr: "proposed", rfc: "draft", rule: "active" };

function normalizeActionSpec(raw, kind) {
  const type = String(raw.type || "").toLowerCase();
  let layer = normalizeLayer(raw.layer) || TYPE_TO_LAYER[type] || parseSpecId(String(raw.id || ""))?.layer || null;
  if (!layer) return null;
  const axis = axisForLayer(layer);
  const dependencies = Array.isArray(raw.dependencies)
    ? raw.dependencies.filter((dep) => dep && (dep.id || typeof dep === "string")).map((dep) => (typeof dep === "string" ? { id: dep.toUpperCase(), type: "depends-on" } : { id: String(dep.id).toUpperCase(), type: String(dep.relation || dep.type || "depends-on").toLowerCase() }))
    : [];
  return {
    id: String(raw.id || "").toUpperCase().trim(),
    action: kind,
    layer,
    axis,
    type: axis,
    title: String(raw.title || raw.id || "").trim(),
    status: raw.status ? String(raw.status).toLowerCase() : DEFAULT_STATUS[layer] || "draft",
    confidence: raw.confidence ? String(raw.confidence).toLowerCase() : "low",
    version: raw.version ? String(raw.version) : "1.0.0",
    owner: raw.owner ? String(raw.owner) : "",
    domain: raw.domain ? String(raw.domain) : "",
    subdomain: raw.subdomain ? String(raw.subdomain) : "",
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    dependencies,
    activates: Array.isArray(raw.activates) ? raw.activates.map((id) => String(id).toUpperCase()) : [],
    parent: raw.parent ? String(raw.parent).toUpperCase() : "",
    task_kind: raw.task_kind ? String(raw.task_kind) : "",
    body: String(raw.body || "").trim(),
    reasoning: String(raw.reasoning || "").trim(),
    selected: true,
  };
}

/**
 * Construye el preview de un paquete a partir de las acciones del modelo.
 * `store` es el SpecStore de la caja destino (para colisiones de id y specs persistidas).
 */
export function buildPackagePreview(actions, { store, sourceId, kind = "work" }) {
  const specs = [];
  const modifications = [];
  const warnings = [];
  const list = Array.isArray(actions) ? actions : [];
  for (const action of list) {
    const type = String(action?.action_type || "");
    if (type === "propose_new_spec" && action.spec) {
      const spec = normalizeActionSpec({ ...action.spec, reasoning: action.reasoning || action.spec.reasoning }, "create");
      if (spec) specs.push(spec);
      else warnings.push(`Se ignoró una spec sin capa reconocible (${action.spec?.id || "sin id"}).`);
    } else if (type === "propose_persisted_modification" || type === "propose_modification") {
      for (const item of Array.isArray(action.specs) ? action.specs : []) {
        const id = String(item?.id || "").toUpperCase();
        if (!id) continue;
        if (!store.get(id)) {
          warnings.push(`${id}: la modificación apunta a una spec que no existe; se ignora.`);
          continue;
        }
        modifications.push({ id, body: item.body ? String(item.body) : "", title: item.title ? String(item.title) : "", dependencies: Array.isArray(item.dependencies) ? item.dependencies.map((dep) => ({ id: String(dep.id).toUpperCase(), type: String(dep.relation || dep.type || "depends-on") })) : null, reasoning: String(item.reasoning || action.reasoning || ""), selected: true });
      }
    } else if (type === "deprecate_spec") {
      const id = String(action.spec_id || action.id || "").toUpperCase();
      if (store.get(id)) modifications.push({ id, status: action.reactivate ? "active" : "deprecated", reasoning: String(action.reasoning || ""), selected: true });
    }
  }
  // Ids: garantizar patrón de caja y sin colisiones.
  const taken = new Set(store.ids());
  const renames = new Map();
  for (const spec of specs) {
    const parsed = parseSpecId(spec.id);
    const upperSource = String(sourceId || "").toUpperCase();
    let domain = parsed?.domain || "";
    if (parsed && !parsed.sourceId && parsed.domain && upperSource) {
      const segments = parsed.domain.split("-");
      domain = segments.length > 1 ? segments.slice(0, -1).join("-") : parsed.domain;
    }
    let finalId = spec.id;
    const wellFormed = parsed && (!upperSource || parsed.sourceId === upperSource);
    if (!wellFormed) {
      finalId = buildSpecId({ layer: spec.layer, domain, sourceId: upperSource || undefined, number: parsed?.number || nextSpecNumber([...taken], { layer: spec.layer, domain, sourceId: upperSource || undefined }) });
    }
    if (taken.has(finalId)) finalId = buildSpecId({ layer: spec.layer, domain, sourceId: upperSource || undefined, number: nextSpecNumber([...taken], { layer: spec.layer, domain, sourceId: upperSource || undefined }) });
    if (finalId !== spec.id) {
      renames.set(spec.id, finalId);
      warnings.push(`Identificador ajustado: ${spec.id} → ${finalId}.`);
      spec.id = finalId;
    }
    taken.add(finalId);
  }
  for (const spec of specs) {
    spec.dependencies = spec.dependencies.map((dep) => ({ ...dep, id: renames.get(dep.id) || dep.id }));
    spec.activates = spec.activates.map((id) => renames.get(id) || id);
    if (spec.parent) spec.parent = renames.get(spec.parent) || spec.parent;
  }
  const known = new Set([...store.ids(), ...specs.map((spec) => spec.id)]);
  for (const spec of specs) {
    const issues = validateSpecStructure({ ...spec });
    for (const dep of spec.dependencies) if (!known.has(dep.id)) issues.push({ code: "broken-reference", severity: "warning", message: `Dependencia hacia ${dep.id}, que no existe.` });
    if (spec.layer === "work-spec") {
      const missing = spec.activates.filter((id) => !known.has(id));
      if (missing.length) issues.push({ code: "broken-activates", severity: "error", message: `activates apunta a specs inexistentes: ${missing.join(", ")}.` });
      if (!spec.activates.length && store.byAxis("knowledge").length) issues.push({ code: "empty-activates", severity: "warning", message: "La WRK-SPEC no activa ningún conocimiento aunque la caja lo tiene." });
    }
    if (spec.layer !== "work-spec" && spec.axis === "work" && spec.parent && !known.has(spec.parent)) issues.push({ code: "missing-parent", severity: "error", message: `parent apunta a ${spec.parent}, que no existe.` });
    spec.issues = issues;
    spec.blocking = issues.some((issue) => issue.severity === "error");
  }
  if (kind === "work") {
    const plans = specs.filter((spec) => spec.layer === "work-plan");
    const tasks = specs.filter((spec) => spec.layer === "work-task");
    for (const plan of plans) {
      if (!tasks.some((task) => task.parent === plan.id)) {
        plan.issues.push({ code: "missing-task-breakdown", severity: "error", message: "El plan no trae tareas en el mismo paquete." });
        plan.blocking = true;
      }
    }
    const workSpecs = specs.filter((spec) => spec.layer === "work-spec");
    for (const workSpec of workSpecs) {
      const hasPlan = plans.some((plan) => plan.parent === workSpec.id) || store.byLayer("work-plan").some((plan) => plan.parent === workSpec.id);
      if (!hasPlan) workSpec.issues.push({ code: "spec-without-plan", severity: "warning", message: "La iniciativa no tiene plan todavía: la creación queda incompleta hasta emitir el plan y sus tareas." });
    }
  }
  const blocking = specs.some((spec) => spec.blocking);
  const digest = createHash("sha1").update(JSON.stringify(specs.map((spec) => [spec.id, spec.body]))).digest("hex").slice(0, 8);
  return { id: `pkg-${digest}`, kind, sourceId, specs, modifications, warnings, blocking, createdAt: new Date().toISOString(), summary: summarizePackage(specs, modifications) };
}

function summarizePackage(specs, modifications) {
  const counts = {};
  for (const spec of specs) counts[spec.layer] = (counts[spec.layer] || 0) + 1;
  const parts = Object.entries(counts).map(([layer, count]) => `${count} ${LAYERS[layer]?.label || layer}${count > 1 ? "s" : ""}`);
  if (modifications.length) parts.push(`${modifications.length} modificación${modifications.length > 1 ? "es" : ""} de specs existentes`);
  return parts.join(", ") || "sin specs";
}

/** Persiste un paquete confirmado (specs nuevas + modificaciones). */
export async function persistPackage(pkg, { store, sourceCode, generatedBy = "doriath-chat", force = false } = {}) {
  const results = [];
  const selected = pkg.specs.filter((spec) => spec.selected !== false);
  if (!force && pkg.kind === "work" && selected.some((spec) => spec.blocking)) {
    throw Object.assign(new Error("El paquete Work tiene specs con incidencias bloqueantes; corrígelas o pide al asistente que las corrija."), { status: 409 });
  }
  const order = { "work-spec": 0, "work-plan": 1, "work-task": 2 };
  const ordered = [...selected].sort((a, b) => (order[a.layer] ?? -1) - (order[b.layer] ?? -1));
  const known = new Set([...store.ids(), ...ordered.map((spec) => spec.id)]);
  for (const spec of ordered) {
    try {
      const saved = await store.create({
        id: spec.id,
        layer: spec.layer,
        axis: spec.axis,
        type: spec.axis,
        title: spec.title,
        status: spec.status,
        confidence: spec.confidence,
        version: spec.version,
        owner: spec.owner || "pending",
        domain: spec.domain,
        subdomain: spec.subdomain,
        tags: spec.tags,
        dependencies: spec.dependencies.filter((dep) => known.has(dep.id)),
        activates: spec.activates.filter((id) => known.has(id)),
        parent: spec.parent,
        task_kind: spec.task_kind,
        source: sourceCode,
        body: spec.body,
      }, { generatedBy });
      results.push({ id: saved.id, action: "created" });
    } catch (error) {
      results.push({ id: spec.id, action: "error", error: error.message });
    }
  }
  for (const modification of pkg.modifications.filter((item) => item.selected !== false)) {
    try {
      if (modification.status) {
        await store.setStatus(modification.id, modification.status);
        results.push({ id: modification.id, action: modification.status });
      } else {
        const { spec, protected: wasProtected } = await store.update(modification.id, {
          body: modification.body || undefined,
          title: modification.title || undefined,
          dependencies: modification.dependencies || undefined,
        }, { protectValidated: true, bump: "minor", evidenceNote: modification.reasoning ? `Chat de creación: ${modification.reasoning}` : "" });
        results.push({ id: spec.id, action: wasProtected ? "evidence-only" : "modified", version: spec.version });
      }
    } catch (error) {
      results.push({ id: modification.id, action: "error", error: error.message });
    }
  }
  return results;
}
