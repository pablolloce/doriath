import { readFile } from "node:fs/promises";
import path from "node:path";
import { paths } from "../paths.mjs";

/**
 * Carga de prompts de KDD Studio y del preámbulo canónico KDD (mismo orden que el loader original:
 * principios -> taxonomía -> tipos -> anatomía -> workflow de 5 pasos -> prompt concreto).
 */
const BUNDLE_FILES = [
  { rel: ["foundation", "principles.md"], label: "KDD Design Principles" },
  { rel: ["knowledge-architecture", "unified-taxonomy.md"], label: "KDD Unified Taxonomy (3 axes)" },
  { rel: ["knowledge-architecture", "spec-types.md"], label: "KDD Spec Types & Governance Cycle" },
  { rel: ["knowledge-architecture", "spec-anatomy.md"], label: "KDD Spec Anatomy & Frontmatter Schema" },
];

const cache = new Map();

async function readCached(file) {
  if (cache.has(file)) return cache.get(file);
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    text = "";
  }
  cache.set(file, text);
  return text;
}

export async function loadKddPreamble({ includeWorkflow = true } = {}) {
  const parts = [];
  for (const entry of BUNDLE_FILES) {
    const content = await readCached(path.join(paths.kddReferenceDir, ...entry.rel));
    if (content) parts.push(`# [KDD Reference] ${entry.label}\n\n> Source: spec-driven/${entry.rel.join("/")}\n\n${content.trim()}`);
  }
  if (includeWorkflow) {
    const workflow = await readCached(path.join(paths.kddReferenceDir, "kdd-workflow.md"));
    if (workflow) parts.push(workflow.trim());
  }
  return parts.join("\n\n---\n\n");
}

export async function loadVerticalTaxonomy(name = "cib-taxonomy") {
  return readCached(path.join(paths.kddReferenceDir, "knowledge-architecture", "verticals", `${name}.md`));
}

export async function loadPrompt(name) {
  const text = await readCached(path.join(paths.promptsDir, `${name}.prompt.md`));
  if (!text) throw new Error(`Prompt no encontrado: ${name}`);
  return text;
}

export async function loadSpecDrivenPrompt(name, { includeWorkflow = true } = {}) {
  const [preamble, prompt] = await Promise.all([loadKddPreamble({ includeWorkflow }), loadPrompt(name)]);
  return `${preamble}\n\n---\n\n# [Prompt] ${name}\n\n${prompt.trim()}`;
}

/** Sustituye `{PLACEHOLDER}` por su valor; los que no reciben valor se dejan vacíos. */
export function renderTemplate(template, values = {}) {
  return String(template).replace(/\{([A-Z0-9_]+)\}/g, (match, key) => {
    if (Object.hasOwn(values, key)) return String(values[key] ?? "");
    return "";
  });
}

export function clearPromptCache() {
  cache.clear();
}
