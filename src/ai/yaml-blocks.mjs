import yaml from "js-yaml";

/**
 * Los prompts de KDD Studio piden al modelo un único bloque YAML que empieza por una clave conocida
 * (`extraction:`, `plan:`, `generation:`, `actions:`) y termina en un marcador (`#END_OF_PLAN`).
 * Estas utilidades recortan ese bloque de una respuesta que puede traer prosa o fences alrededor.
 */
export function stripFences(text) {
  let out = String(text || "");
  out = out.replace(/```(?:yaml|yml)?\s*\n/gi, "\n").replace(/\n```\s*$/g, "\n").replace(/\n```\s*\n/g, "\n");
  return out;
}

export function hasEndMarker(text, marker) {
  return new RegExp(`^\\s*${marker}\\s*$`, "m").test(String(text || ""));
}

export function extractYamlBlock(text, { startKey, endMarker }) {
  const source = stripFences(text);
  const startRegex = new RegExp(`^${startKey}:\\s*$`, "m");
  const start = source.search(startRegex);
  if (start < 0) return null;
  let block = source.slice(start);
  if (endMarker) {
    const end = block.search(new RegExp(`^\\s*${endMarker}\\s*$`, "m"));
    if (end >= 0) block = block.slice(0, end);
  }
  return block.trimEnd();
}

function repairYaml(block) {
  return String(block)
    .replace(/\t/g, "  ")
    .replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*):\s*(\*[^\s].*)$/gm, '$1: "$2"');
}

export function parseYamlLenient(block) {
  try {
    return yaml.load(block, { schema: yaml.JSON_SCHEMA });
  } catch (firstError) {
    try {
      return yaml.load(repairYaml(block), { schema: yaml.JSON_SCHEMA });
    } catch {
      try {
        const documents = yaml.loadAll(block, null, { schema: yaml.JSON_SCHEMA });
        return Object.assign({}, ...documents.filter((doc) => doc && typeof doc === "object"));
      } catch {
        const error = new Error(`No se pudo interpretar el bloque YAML del modelo: ${firstError.message}`);
        error.code = "YAML_PARSE";
        throw error;
      }
    }
  }
}

/** Devuelve el objeto del bloque YAML o lanza error descriptivo. */
export function parseModelYaml(text, { startKey, endMarker }) {
  const block = extractYamlBlock(text, { startKey, endMarker });
  if (!block) {
    const error = new Error(`La respuesta del modelo no contiene el bloque '${startKey}:' esperado.`);
    error.code = "YAML_MISSING";
    throw error;
  }
  const parsed = parseYamlLenient(block);
  if (!parsed || typeof parsed !== "object") throw Object.assign(new Error("El bloque YAML está vacío."), { code: "YAML_EMPTY" });
  return parsed;
}

/** Une una respuesta partida en continuaciones: se descartan cabeceras repetidas del segundo trozo. */
export function mergeContinuation(previous, continuation) {
  const next = stripFences(continuation).replace(/^\s*(extraction|plan|generation|actions):\s*\n/, "");
  return `${previous.trimEnd()}\n${next}`;
}
