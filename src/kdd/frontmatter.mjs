import matter from "gray-matter";
import yaml from "js-yaml";
import { normalizeLayer, axisForLayer, RELATION_TYPES, CONFIDENCE_LEVELS, layerFromId } from "./layout.mjs";

const LEGACY_FLAT_FIELDS = ["depends-on", "implements", "constrained-by", "extends", "uses-data-from", "supersedes"];

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeDependencies(raw, warnings) {
  const out = [];
  for (const item of toArray(raw)) {
    if (!item) continue;
    if (typeof item === "string") {
      out.push({ id: item.toUpperCase(), type: "depends-on" });
      continue;
    }
    if (typeof item === "object" && item.id) {
      const type = String(item.type || item.relation || "depends-on").toLowerCase();
      if (!RELATION_TYPES.includes(type)) warnings.push(`Relación desconocida '${type}' hacia ${item.id}.`);
      out.push({ id: String(item.id).toUpperCase(), type });
    }
  }
  return out;
}

function normalizeDate(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Parsea un fichero Markdown con frontmatter YAML y devuelve una spec normalizada.
 * Los campos legacy planos (`implements:` como clave suelta) se convierten a `dependencies` con aviso,
 * en vez de rechazar el fichero: una caja escrita a mano debe poder abrirse.
 */
export function parseSpecMarkdown(text, { filePath = "" } = {}) {
  const warnings = [];
  const errors = [];
  let parsed;
  try {
    parsed = matter(String(text || ""), { language: "yaml" });
  } catch (error) {
    return { spec: null, errors: [`Frontmatter YAML inválido en ${filePath}: ${error.message}`], warnings };
  }
  const fm = parsed.data || {};
  if (!fm.id) errors.push(`Falta 'id' en ${filePath}.`);
  const id = String(fm.id || "").toUpperCase();
  const layer = normalizeLayer(fm.layer) || layerFromId(id);
  if (!layer) errors.push(`Capa desconocida o ausente (${fm.layer}) en ${filePath}.`);
  if (errors.length) return { spec: null, errors, warnings };

  const dependencies = normalizeDependencies(fm.dependencies, warnings);
  for (const field of LEGACY_FLAT_FIELDS) {
    if (fm[field] === undefined) continue;
    warnings.push(`Campo legacy '${field}' convertido a dependencies en ${id}.`);
    for (const target of toArray(fm[field])) {
      if (typeof target === "string") dependencies.push({ id: target.toUpperCase(), type: field });
    }
  }
  const activates = toArray(fm.activates).filter((value) => typeof value === "string").map((value) => value.toUpperCase());
  const axis = axisForLayer(layer);
  const confidence = CONFIDENCE_LEVELS.includes(String(fm.confidence || "").toLowerCase()) ? String(fm.confidence).toLowerCase() : "low";
  const body = parsed.content.replace(/^\s*\n/, "");
  const title = fm.title || firstHeading(body, id);

  const spec = {
    id,
    layer,
    axis,
    type: fm.type || axis,
    subtype: fm.subtype,
    title,
    status: String(fm.status || "draft").toLowerCase(),
    confidence,
    version: String(fm.version || "1.0.0"),
    owner: fm.owner ? String(fm.owner) : "",
    domain: fm.domain ? String(fm.domain) : "",
    subdomain: fm.subdomain ? String(fm.subdomain) : "",
    created: normalizeDate(fm.created),
    updated: normalizeDate(fm.updated),
    reviewers: toArray(fm.reviewers).map(String),
    tags: toArray(fm.tags).map(String),
    dependencies,
    activates,
    parent: fm.parent ? String(fm.parent).toUpperCase() : "",
    task_kind: fm.task_kind ? String(fm.task_kind) : "",
    supersedes: fm.supersedes ? String(fm.supersedes).toUpperCase() : "",
    source: fm.source ? String(fm.source).toUpperCase() : "",
    scope: fm.scope || (axis === "work" ? "ephemeral" : "persistent"),
    generatedBy: fm["generated-by"] || "",
    generatedAt: fm["generated-at"] || "",
    manualEdits: Boolean(fm["manual-edits"]),
    bbvaOne: fm.bbva_one && typeof fm.bbva_one === "object" ? fm.bbva_one : undefined,
    extra: {},
    body,
    filePath,
  };
  const known = new Set(["id", "type", "layer", "subtype", "title", "status", "confidence", "version", "owner", "domain", "subdomain", "created", "updated", "reviewers", "tags", "dependencies", "activates", "parent", "task_kind", "supersedes", "source", "scope", "generated-by", "generated-at", "manual-edits", "bbva_one", ...LEGACY_FLAT_FIELDS]);
  for (const [key, value] of Object.entries(fm)) if (!known.has(key)) spec.extra[key] = value;
  return { spec, errors, warnings };
}

function firstHeading(body, fallback) {
  const match = /^#\s+(.+)$/m.exec(body || "");
  if (!match) return fallback;
  return match[1].replace(new RegExp(`^${fallback}\\s*[—–-]\\s*`), "").trim();
}

/** Serializa una spec a Markdown con frontmatter en un orden de claves estable. */
export function serializeSpecMarkdown(spec) {
  const fm = {
    id: spec.id,
    type: spec.type || spec.axis,
    layer: spec.layer,
    ...(spec.title ? { title: spec.title } : {}),
    ...(spec.subtype ? { subtype: spec.subtype } : {}),
    status: spec.status || "draft",
    confidence: spec.confidence || "low",
    version: spec.version || "1.0.0",
    ...(spec.owner ? { owner: spec.owner } : {}),
    ...(spec.domain ? { domain: spec.domain } : {}),
    ...(spec.subdomain ? { subdomain: spec.subdomain } : {}),
    ...(spec.scope ? { scope: spec.scope } : {}),
    ...(spec.created ? { created: spec.created } : {}),
    ...(spec.updated ? { updated: spec.updated } : {}),
    ...(spec.source ? { source: spec.source } : {}),
    ...(spec.parent ? { parent: spec.parent } : {}),
    ...(spec.task_kind ? { task_kind: spec.task_kind } : {}),
    ...(spec.activates?.length ? { activates: spec.activates } : {}),
    ...(spec.supersedes ? { supersedes: spec.supersedes } : {}),
    ...(spec.reviewers?.length ? { reviewers: spec.reviewers } : {}),
    dependencies: (spec.dependencies || []).map((dep) => ({ id: dep.id, type: dep.type })),
    ...(spec.tags?.length ? { tags: spec.tags } : {}),
    ...(spec.generatedBy ? { "generated-by": spec.generatedBy } : {}),
    ...(spec.generatedAt ? { "generated-at": spec.generatedAt } : {}),
    ...(spec.manualEdits ? { "manual-edits": true } : {}),
    ...(spec.bbvaOne ? { bbva_one: spec.bbvaOne } : {}),
    ...(spec.extra || {}),
  };
  const yamlText = yaml.dump(fm, { lineWidth: 120, noRefs: true, quotingType: '"' }).trimEnd();
  let body = String(spec.body || "").trim();
  if (!/^#\s/.test(body)) body = `# ${spec.id} — ${spec.title || spec.id}\n\n${body}`;
  return `---\n${yamlText}\n---\n\n${body}\n`;
}

export function bumpVersion(version, part = "patch") {
  const [major = 1, minor = 0, patch = 0] = String(version || "1.0.0").split(".").map((value) => Number(value) || 0);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
