import path from "node:path";
import { randomUUID } from "node:crypto";
import { cacheDir } from "./layout.mjs";
import { readJson, writeJson } from "../util/fs.mjs";

/**
 * Registro de gobernanza de una base de conocimiento: quién ha cambiado qué, cuándo y desde dónde.
 * Vive dentro de la propia caja (`.kdd-studio/activity.json`) para que viaje con ella y lo vea todo
 * el equipo, junto con la autoría de cada documento importado y las specs que generó.
 */
const MAX_ENTRIES = 500;
export const ACTIVITY_KINDS = Object.freeze(["import", "analysis", "edit", "chat", "governance"]);

function activityFile(sourceDir) {
  return path.join(cacheDir(sourceDir), "activity.json");
}

async function read(sourceDir) {
  const data = await readJson(activityFile(sourceDir), null);
  return {
    entries: Array.isArray(data?.entries) ? data.entries : [],
    documents: data?.documents && typeof data.documents === "object" ? data.documents : {},
  };
}

async function write(sourceDir, data) {
  await writeJson(activityFile(sourceDir), data);
}

/** Añade un evento al registro. `specs` son los identificadores afectados, para poder filtrar luego. */
export async function recordActivity(sourceDir, { actor, kind = "edit", title, detail = "", specs = [], documents = [] } = {}) {
  if (!sourceDir || !title) return null;
  const data = await read(sourceDir);
  const entry = {
    id: randomUUID().slice(0, 8),
    at: new Date().toISOString(),
    actor: actor || "usuario local",
    kind: ACTIVITY_KINDS.includes(kind) ? kind : "edit",
    title,
    detail,
    specs: [...new Set(specs.filter(Boolean))],
    documents: [...new Set(documents.filter(Boolean))],
  };
  data.entries.unshift(entry);
  data.entries = data.entries.slice(0, MAX_ENTRIES);
  await write(sourceDir, data);
  return entry;
}

export async function listActivity(sourceDir, { limit = 120, kind = "", actor = "", spec = "" } = {}) {
  const { entries } = await read(sourceDir);
  const filtered = entries.filter((entry) => (!kind || entry.kind === kind)
    && (!actor || entry.actor === actor)
    && (!spec || entry.specs?.includes(spec) || entry.title.includes(spec) || entry.detail.includes(spec)));
  return {
    entries: filtered.slice(0, limit),
    total: entries.length,
    actors: [...new Set(entries.map((entry) => entry.actor))].sort(),
  };
}

/** Autoría e impacto de los documentos: quién los subió y qué specs salieron de ellos. */
export async function documentsMeta(sourceDir) {
  return (await read(sourceDir)).documents;
}

export async function recordDocumentImport(sourceDir, name, actor) {
  const data = await read(sourceDir);
  data.documents[name] = { ...(data.documents[name] || {}), importedBy: actor || "usuario local", importedAt: new Date().toISOString(), specs: data.documents[name]?.specs || [] };
  await write(sourceDir, data);
  return data.documents[name];
}

export async function attachSpecsToDocuments(sourceDir, names, specIds) {
  if (!names?.length || !specIds?.length) return;
  const data = await read(sourceDir);
  for (const name of names) {
    const current = data.documents[name] || { importedBy: "usuario local", importedAt: new Date().toISOString(), specs: [] };
    current.specs = [...new Set([...(current.specs || []), ...specIds])];
    current.analyzedAt = new Date().toISOString();
    data.documents[name] = current;
  }
  await write(sourceDir, data);
}

export async function forgetDocument(sourceDir, name) {
  const data = await read(sourceDir);
  if (!data.documents[name]) return;
  delete data.documents[name];
  await write(sourceDir, data);
}
