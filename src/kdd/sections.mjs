import { LAYERS } from "./layout.mjs";

/**
 * Secciones canónicas del body. Los headers se buscan por nombre exacto en inglés (como el validador de
 * KDD Studio) con unos pocos alias en español para cajas escritas a mano.
 */
export const SECTION_ALIASES = Object.freeze({
  "Intent": ["Intent", "Purpose", "Propósito", "Proposito", "Objetivo"],
  "Definition": ["Definition", "Definición", "Definicion", "Contents", "Components", "Scope", "Alcance", "Details"],
  "Acceptance Criteria": ["Acceptance Criteria", "Criterios de aceptación", "Criterios de aceptacion", "Acceptance"],
  "Evidence": ["Evidence", "Evidencia"],
  "Traceability": ["Traceability", "Trazabilidad", "References", "Referencias"],
  "Problem Statement": ["Problem Statement", "Problema", "Issue"],
  "Proposed Change": ["Proposed Change", "Proposal", "Cambio Propuesto", "Propuesta"],
  "Proposed Solution": ["Proposed Solution", "Solution", "Solución"],
  "Approach": ["Approach", "Strategy", "Estrategia"],
  "Task Breakdown": ["Task Breakdown", "Tasks", "Tareas", "Breakdown"],
  "Objective": ["Objective", "Objetivo", "Goal"],
  "Context": ["Context", "Contexto"],
  "Decision": ["Decision", "Decisión"],
  "Rationale": ["Rationale", "Justificación"],
  "Consequences": ["Consequences", "Consecuencias"],
  "Rule": ["Rule", "Regla"],
  "Enforcement": ["Enforcement", "Validación", "Validation"],
  "Open Questions": ["Open Questions", "Preguntas abiertas"],
  "Implementation Notes": ["Implementation Notes", "Notas de implementación"],
  "Knowledge Context": ["Knowledge Context", "Contexto de conocimiento"],
  "Constraints": ["Constraints", "Restricciones"],
});

/** Divide un body Markdown en secciones `## Título` (nivel 2 y 3), conservando el orden. */
export function splitSections(body) {
  const sections = [];
  const lines = String(body || "").split(/\r?\n/);
  let current = { title: "", level: 0, lines: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    const match = !inFence && /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      sections.push(current);
      current = { title: match[2].trim(), level: match[1].length, lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);
  return sections.map((section) => ({ ...section, content: section.lines.join("\n").trim() }));
}

export function findSection(body, canonicalName) {
  const aliases = (SECTION_ALIASES[canonicalName] || [canonicalName]).map((alias) => alias.toLowerCase());
  for (const section of splitSections(body)) {
    if (section.level === 2 && aliases.includes(section.title.toLowerCase())) return section;
  }
  return null;
}

const VERIFIABLE_PATTERNS = [
  /\b(valida|rechaza|bloquea|permite|emite|devuelve|procesa|escala|responde|completa|persiste|registra|cifra|firma|genera|lanza|calcula|expone|publica|consume|notifica|retorna|acepta|deniega|crea|elimina|actualiza el estado|marca|reintenta|expira|limita)\b/i,
  /\b(si|cuando|dado|given|when)\b.+\b(entonces|then|→|->)\b/i,
  /\b(returns|rejects|validates|responds|persists|emits|blocks|allows|processes|completes)\b/i,
  /\b(menos de|más de|mas de|al menos|como máximo|como maximo|<|>|≤|≥)\s*\d/i,
  /\b\d+\s*(ms|s|min|h|%|MB|KB|registros|posiciones|peticiones)\b/i,
  /\bHTTP\s*\d{3}\b/i,
];
const ASPIRATIONAL_PATTERNS = [/\b(debe|debería|deberia|funcionará|funcionara|mejora|optimiza|moderniza|renueva|soporta correctamente|gestiona adecuadamente)\b/i];

export function countAcceptanceCriteria(sectionContent) {
  const items = String(sectionContent || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => /^([-*]|\d+[.)])\s+/.test(line));
  let verifiable = 0;
  for (const item of items) {
    const text = item.replace(/^([-*]|\d+[.)])\s+(\[[ xX]\]\s*)?/, "");
    const positive = VERIFIABLE_PATTERNS.some((pattern) => pattern.test(text));
    const aspirational = ASPIRATIONAL_PATTERNS.some((pattern) => pattern.test(text)) && !positive;
    if (positive && !aspirational) verifiable += 1;
  }
  return { total: items.length, verifiable };
}

/**
 * Validación estructural de una spec: secciones canónicas de su capa, criterios verificables y
 * coherencia de campos Work. Devuelve `issues` con código, severidad y mensaje.
 */
export function validateSpecStructure(spec) {
  const issues = [];
  const definition = LAYERS[spec.layer];
  if (!definition) return [{ code: "unknown-layer", severity: "error", message: `Capa desconocida ${spec.layer}.` }];
  for (const section of definition.sections) {
    const found = findSection(spec.body, section);
    if (!found) {
      const optional = ["Evidence", "Traceability"].includes(section);
      issues.push({ code: `missing-${section.toLowerCase().replace(/\s+/g, "-")}`, severity: optional ? "warning" : "error", message: `Falta la sección "## ${section}".` });
      continue;
    }
    if (section === "Acceptance Criteria") {
      const { total, verifiable } = countAcceptanceCriteria(found.content);
      if (total === 0) issues.push({ code: "missing-acceptance-criteria", severity: "error", message: "La sección Acceptance Criteria no tiene criterios listados." });
      else if (verifiable === 0) issues.push({ code: "unverifiable-acceptance-criteria", severity: "warning", message: "Los criterios de aceptación parecen aspiracionales; reescríbelos con verbos verificables o el patrón cuando X → Y." });
    }
    if (section === "Definition" && found.content.replace(/\s+/g, "").length < 40) {
      issues.push({ code: "thin-definition", severity: "warning", message: "La sección Definition tiene muy poco contenido." });
    }
  }
  if (spec.axis === "work") {
    if (spec.layer !== "work-spec" && !spec.parent) issues.push({ code: "missing-parent", severity: "error", message: "Los planes y tareas necesitan `parent`." });
    if (spec.layer !== "work-spec" && spec.activates?.length) issues.push({ code: "activates-on-child", severity: "warning", message: "`activates` solo se declara en la WRK-SPEC; los hijos lo heredan." });
    if (spec.layer !== "work-spec" && findSection(spec.body, "Open Questions")) issues.push({ code: "open-questions-on-child", severity: "warning", message: "Open Questions solo es canónica en la WRK-SPEC." });
  }
  if (!spec.title) issues.push({ code: "missing-title", severity: "warning", message: "La spec no tiene título." });
  return issues;
}

/** Resumen corto (primer párrafo de Intent/Objective/Problem Statement) para catálogos. */
export function summarizeSpec(spec, max = 240) {
  const candidates = ["Intent", "Objective", "Problem Statement", "Context", "Rule", "Definition"];
  for (const name of candidates) {
    const section = findSection(spec.body, name);
    if (section?.content) {
      const paragraph = section.content.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
      if (paragraph) return paragraph.length > max ? `${paragraph.slice(0, max - 1)}…` : paragraph;
    }
  }
  const plain = String(spec.body || "").replace(/^#.*$/m, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
