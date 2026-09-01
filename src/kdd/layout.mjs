import path from "node:path";

/**
 * Disposición de una base de conocimiento KDD en disco. Es la misma que usa KDD Studio para sus
 * fuentes locales, de modo que una carpeta creada por Doriath se puede abrir en KDD Studio y viceversa.
 *
 *   <kb>/
 *   ├── kdd-source.json            metadatos de la caja (nombre, Source ID, descripción)
 *   ├── specs/
 *   │   ├── architecture/ domain/ product/ features/ docs/
 *   │   ├── work/work-spec/ work/work-plan/ work/work-task/
 *   │   ├── governance/adr/ governance/rfc/ governance/rules/
 *   │   └── _analysis/             historial de decisiones y metadatos de análisis
 *   ├── docs-tecnicos/             documentos importados (PDF, DOCX, ...)
 *   └── .kdd-studio/               cachés derivadas (grafo, índice)
 */
export const LAYERS = Object.freeze({
  architecture: { axis: "knowledge", prefix: "ARCH", folder: ["specs", "architecture"], label: "Arquitectura", sections: ["Intent", "Definition", "Acceptance Criteria", "Evidence", "Traceability"] },
  domain: { axis: "knowledge", prefix: "DOM", folder: ["specs", "domain"], label: "Dominio", sections: ["Intent", "Definition", "Acceptance Criteria", "Evidence", "Traceability"] },
  product: { axis: "knowledge", prefix: "PROD", folder: ["specs", "product"], label: "Producto", sections: ["Intent", "Definition", "Acceptance Criteria", "Evidence", "Traceability"] },
  feature: { axis: "knowledge", prefix: "FEAT", folder: ["specs", "features"], label: "Funcionalidad", sections: ["Intent", "Definition", "Acceptance Criteria", "Evidence", "Traceability"] },
  doc: { axis: "knowledge", prefix: "DOC", folder: ["specs", "docs"], label: "Documentación", sections: ["Intent", "Definition", "Acceptance Criteria", "Evidence", "Traceability"] },
  "work-spec": { axis: "work", prefix: "WRK-SPEC", folder: ["specs", "work", "work-spec"], label: "Iniciativa", sections: ["Problem Statement", "Proposed Change", "Acceptance Criteria"] },
  "work-plan": { axis: "work", prefix: "WRK-PLAN", folder: ["specs", "work", "work-plan"], label: "Plan", sections: ["Approach", "Task Breakdown"] },
  "work-task": { axis: "work", prefix: "WRK-TASK", folder: ["specs", "work", "work-task"], label: "Tarea", sections: ["Objective", "Acceptance Criteria"] },
  adr: { axis: "governance", prefix: "ADR", folder: ["specs", "governance", "adr"], label: "Decisión (ADR)", sections: ["Context", "Decision", "Rationale", "Consequences"] },
  rfc: { axis: "governance", prefix: "RFC", folder: ["specs", "governance", "rfc"], label: "Propuesta (RFC)", sections: ["Problem Statement", "Proposed Solution"] },
  rule: { axis: "governance", prefix: "RULE", folder: ["specs", "governance", "rules"], label: "Regla", sections: ["Rule", "Enforcement"] },
});

export const LAYER_ALIASES = Object.freeze({
  documentation: "doc",
  docs: "doc",
  features: "feature",
  rules: "rule",
  "work_spec": "work-spec",
  "work_plan": "work-plan",
  "work_task": "work-task",
});

export const KNOWLEDGE_LAYERS = Object.freeze(["architecture", "domain", "product", "feature", "doc"]);
export const WORK_LAYERS = Object.freeze(["work-spec", "work-plan", "work-task"]);
export const GOVERNANCE_LAYERS = Object.freeze(["adr", "rfc", "rule"]);
export const ALL_LAYERS = Object.freeze([...KNOWLEDGE_LAYERS, ...WORK_LAYERS, ...GOVERNANCE_LAYERS]);

export const STATUS_BY_AXIS = Object.freeze({
  knowledge: ["draft", "active", "deprecated"],
  work: ["draft", "active", "completed", "archived"],
  governance: ["draft", "discussion", "proposed", "accepted", "rejected", "withdrawn", "active", "deprecated", "superseded"],
});

export const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);

export const RELATION_TYPES = Object.freeze(["implements", "constrained-by", "extends", "uses-data-from", "activates", "depends-on", "parent", "supersedes"]);

export const INVERSE_RELATIONS = Object.freeze({
  implements: "implemented-by",
  "constrained-by": "constrains",
  extends: "extended-by",
  "uses-data-from": "data-used-by",
  activates: "activated-by",
  "depends-on": "depended-on-by",
  parent: "children",
  supersedes: "superseded-by",
});

export const SOURCE_META_FILE = "kdd-source.json";
export const DOCUMENTS_DIR = "docs-tecnicos";
export const CACHE_DIR = ".kdd-studio";
export const ANALYSIS_DIR = ["specs", "_analysis"];
export const DECISION_HISTORY_FILE = "decision-history.json";

export function normalizeLayer(layer) {
  const value = String(layer || "").trim().toLowerCase();
  return LAYERS[value] ? value : LAYER_ALIASES[value] || null;
}

export function axisForLayer(layer) {
  return LAYERS[normalizeLayer(layer)]?.axis || null;
}

export function layerFolder(sourceDir, layer) {
  const definition = LAYERS[normalizeLayer(layer)];
  if (!definition) throw new Error(`Capa desconocida: ${layer}`);
  return path.join(sourceDir, ...definition.folder);
}

export function allLayerFolders(sourceDir) {
  return ALL_LAYERS.map((layer) => ({ layer, dir: layerFolder(sourceDir, layer) }));
}

export function documentsDir(sourceDir) {
  return path.join(sourceDir, DOCUMENTS_DIR);
}

export function cacheDir(sourceDir) {
  return path.join(sourceDir, CACHE_DIR);
}

export function analysisDir(sourceDir) {
  return path.join(sourceDir, ...ANALYSIS_DIR);
}

/** Capa a partir del prefijo del identificador (WRK-SPEC-..., DOM-..., ...). */
export function layerFromId(id) {
  const upper = String(id || "").toUpperCase();
  const entries = Object.entries(LAYERS).sort((a, b) => b[1].prefix.length - a[1].prefix.length);
  for (const [layer, definition] of entries) {
    if (upper.startsWith(`${definition.prefix}-`)) return layer;
  }
  return null;
}
