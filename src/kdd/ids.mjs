import { LAYERS, layerFromId } from "./layout.mjs";

/**
 * Identificadores KDD: `TIPO-[SEGMENTOS-]<FUENTE>-NNN`.
 * En despliegues multi-caja el Source ID (`S###`) va justo antes del número. Se admiten también los
 * IDs del framework de referencia sin fuente (`DOM-RISK-001`) para poder abrir cajas antiguas.
 */
export const SOURCE_ID_PATTERN = /^S\d{3,}$/i;

export function parseSpecId(id) {
  const value = String(id || "").trim().toUpperCase();
  const layer = layerFromId(value);
  if (!layer) return null;
  const prefix = LAYERS[layer].prefix;
  const rest = value.slice(prefix.length + 1);
  const match = /^(?:([A-Z0-9]+(?:-[A-Z0-9]+)*)-)?(\d{3,})$/.exec(rest);
  if (!match) return null;
  const segments = match[1] ? match[1].split("-") : [];
  const number = Number(match[2]);
  let sourceId = null;
  let domainSegments = segments;
  if (segments.length && SOURCE_ID_PATTERN.test(segments[segments.length - 1])) {
    sourceId = segments[segments.length - 1];
    domainSegments = segments.slice(0, -1);
  }
  return { id: value, layer, prefix, sourceId, domain: domainSegments.join("-") || null, number, numberText: match[2] };
}

export function isValidSpecId(id) {
  return Boolean(parseSpecId(id));
}

export function buildSpecId({ layer, domain, sourceId, number }) {
  const definition = LAYERS[layer];
  if (!definition) throw new Error(`Capa desconocida: ${layer}`);
  const parts = [definition.prefix];
  if (domain) parts.push(String(domain).toUpperCase().replace(/[^A-Z0-9-]/g, ""));
  if (sourceId) parts.push(String(sourceId).toUpperCase());
  parts.push(String(number).padStart(3, "0"));
  return parts.join("-");
}

/** Siguiente número libre dentro del par (dominio, fuente) para una capa. */
export function nextSpecNumber(existingIds, { layer, domain, sourceId }) {
  let max = 0;
  for (const id of existingIds) {
    const parsed = parseSpecId(id);
    if (!parsed || parsed.layer !== layer) continue;
    if ((parsed.domain || null) !== (domain ? String(domain).toUpperCase() : null)) continue;
    if ((parsed.sourceId || null) !== (sourceId ? String(sourceId).toUpperCase() : null)) continue;
    max = Math.max(max, parsed.number);
  }
  return max + 1;
}

export function allocateSpecId(existingIds, { layer, domain, sourceId }) {
  const number = nextSpecNumber(existingIds, { layer, domain, sourceId });
  return buildSpecId({ layer, domain, sourceId, number });
}

export function extractSpecIds(text) {
  const ids = new Set();
  const regex = /\b(?:ARCH|DOM|PROD|FEAT|DOC|WRK-SPEC|WRK-PLAN|WRK-TASK|ADR|RFC|RULE)-[A-Z0-9-]*\d{3,}\b/g;
  for (const match of String(text || "").toUpperCase().matchAll(regex)) {
    if (parseSpecId(match[0])) ids.add(match[0]);
  }
  return [...ids];
}
