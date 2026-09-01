import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { paths } from "../paths.mjs";
import { buildSpecIndex, Bm25Index, tokenize } from "../kdd/search.mjs";
import { LAYERS } from "../kdd/layout.mjs";
import { summarizeSpec } from "../kdd/sections.mjs";

/**
 * Bloques de contexto compartidos por los prompts (inventario, specs relevantes, few-shot examples,
 * historial de decisiones). Todos devuelven texto listo para sustituir un placeholder.
 */
export function specsInventoryText(specs, { max = 400 } = {}) {
  if (!specs.length) return "(inventario vacío: esta base de conocimiento todavía no tiene specs)";
  const rows = [...specs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, max)
    .map((spec) => `- ${spec.id} | ${spec.layer} | ${spec.status} | ${spec.confidence} | ${spec.title}`);
  const more = specs.length > max ? `\n… y ${specs.length - max} specs más (usa search_specs para localizarlas).` : "";
  return `${rows.join("\n")}${more}`;
}

export function specsCatalogText(specs, { withSummary = true, max = 300 } = {}) {
  if (!specs.length) return "(sin specs)";
  return specs.slice(0, max).map((spec) => `- **${spec.id}** (${LAYERS[spec.layer]?.label || spec.layer}, ${spec.status}, confianza ${spec.confidence}): ${spec.title}${withSummary ? ` — ${summarizeSpec(spec, 160)}` : ""}`).join("\n");
}

export function relevantSpecsText(specs, query, { limit = 10, bodyChars = 2500 } = {}) {
  if (!specs.length) return "(no hay specs previas)";
  const index = buildSpecIndex(specs);
  const hits = index.search(query, { limit });
  if (!hits.length) return "(ninguna spec previa coincide con el vocabulario del documento)";
  return hits.map((hit) => {
    const spec = specs.find((item) => item.id === hit.id);
    const body = spec.body.length > bodyChars ? `${spec.body.slice(0, bodyChars)}\n…` : spec.body;
    return `### ${spec.id} — ${spec.title} (${spec.layer}, ${spec.status}, confianza ${spec.confidence})\n\n${body}`;
  }).join("\n\n");
}

let examplesCache = null;

async function loadExamples() {
  if (examplesCache) return examplesCache;
  const root = path.join(paths.kddReferenceDir, "examples");
  const files = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".md")) files.push(full);
    }
  }
  await walk(root);
  const examples = [];
  const index = new Bm25Index();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const id = path.basename(file, ".md");
    examples.push({ id, text });
    index.add(id, { body: { text } }, { id });
  }
  examplesCache = { examples, index };
  return examplesCache;
}

export async function fewShotExamplesText(query, { limit = 3, maxChars = 3500 } = {}) {
  const { examples, index } = await loadExamples();
  if (!examples.length) return "(sin ejemplos canónicos disponibles)";
  const hits = index.search(query.slice(0, 5000), { limit });
  const chosen = hits.length ? hits.map((hit) => examples.find((item) => item.id === hit.id)) : examples.slice(0, limit);
  return chosen.map((example) => `<!-- ejemplo: ${example.id} -->\n${example.text.length > maxChars ? `${example.text.slice(0, maxChars)}\n…` : example.text}`).join("\n\n---\n\n");
}

export function decisionHistoryText(decisions, { max = 40 } = {}) {
  if (!decisions?.length) return "(sin decisiones previas registradas)";
  return decisions.slice(-max).map((decision) => `- [${String(decision.at || "").slice(0, 10)}] ${decision.question || decision.summary || ""} → ${decision.resolution || decision.decision || ""}${decision.specIds?.length ? ` (${decision.specIds.join(", ")})` : ""}`).join("\n");
}

export function pendingTasksText(pending, { max = 40 } = {}) {
  if (!pending?.length) return "(sin preguntas pendientes de análisis anteriores)";
  return pending.slice(-max).map((item) => `- [${item.kind || "question"}] ${item.text}${item.document ? ` (documento: ${item.document})` : ""}`).join("\n");
}

export function keywordQuery(text, { max = 60 } = {}) {
  const counts = new Map();
  for (const token of tokenize(text)) if (token.length > 3) counts.set(token, (counts.get(token) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([token]) => token).join(" ");
}
