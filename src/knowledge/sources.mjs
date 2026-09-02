import path from "node:path";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { readJson, writeJson, pathExists, ensureDir, writeText, slugify, isPathWithin } from "../util/fs.mjs";
import { paths } from "../paths.mjs";
import { SOURCE_META_FILE, allLayerFolders, documentsDir } from "../kdd/layout.mjs";
import { getSpecStore, dropSpecStore } from "../kdd/store.mjs";
import { buildGraph, graphStats } from "../kdd/graph.mjs";
import { getConfig } from "../config.mjs";
import { listRegisteredRepositories } from "../work/repos.mjs";

/**
 * Registro de bases de conocimiento locales (`sources.json` en la carpeta de datos). Cada entrada
 * apunta a una carpeta KDD. El fichero `kdd-source.json` dentro de la carpeta guarda su identidad
 * (nombre, Source ID) para que la caja sea portable entre equipos.
 */
async function readRegistry() {
  const data = await readJson(paths.sourcesFile, { sources: [] });
  return Array.isArray(data?.sources) ? data.sources : [];
}

async function writeRegistry(sources) {
  await writeJson(paths.sourcesFile, { sources });
}

export async function readSourceMeta(dir) {
  return readJson(path.join(dir, SOURCE_META_FILE), null);
}

async function writeSourceMeta(dir, meta) {
  await writeJson(path.join(dir, SOURCE_META_FILE), meta);
}

/**
 * Una base de conocimiento no puede vivir dentro de la carpeta de salidas del asistente ni dentro de
 * (o conteniendo a) un repositorio ya registrado: mezclarlos ensucia el repo con specs y el asistente
 * podría sobrescribir documentos de la base. Se comprueba en ambas direcciones.
 */
async function assertSourcePathIsSeparate(dir) {
  const outputs = getConfig().paths.outputs;
  if (outputs && isPathWithin(dir, outputs)) {
    throw Object.assign(new Error(`${dir} está dentro de la carpeta de salidas (${outputs}). Las bases de conocimiento y los documentos generados deben ir en carpetas separadas.`), { status: 400 });
  }
  const sources = await readRegistry();
  for (const source of sources) {
    const repositories = await listRegisteredRepositories(source.path).catch(() => []);
    for (const repo of repositories) {
      if (isPathWithin(dir, repo.path) || isPathWithin(repo.path, dir)) {
        throw Object.assign(new Error(`${dir} coincide con el repositorio "${repo.name}" (${repo.path}). Una base de conocimiento no puede vivir dentro de un repositorio, ni al revés.`), { status: 400 });
      }
    }
  }
}

function nextSourceId(sources) {
  let max = 0;
  for (const source of sources) {
    const match = /^S(\d+)$/i.exec(source.sourceId || "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `S${String(max + 1).padStart(3, "0")}`;
}

export async function listSources({ withStats = false } = {}) {
  const sources = await readRegistry();
  const out = [];
  for (const source of sources) {
    const exists = await pathExists(source.path);
    const entry = { ...source, exists };
    if (withStats && exists) {
      try {
        const store = await getSpecStore(source.path).load();
        const stats = graphStats(buildGraph(store.all()));
        const documents = await readdir(documentsDir(source.path)).catch(() => []);
        entry.stats = { ...stats, documents: documents.filter((name) => !name.startsWith(".")).length, parseProblems: store.problems.length };
      } catch (error) {
        entry.stats = { error: error.message };
      }
    }
    out.push(entry);
  }
  return out.sort((a, b) => String(b.lastUsed || "").localeCompare(String(a.lastUsed || "")));
}

export async function getSource(id) {
  const sources = await readRegistry();
  const source = sources.find((item) => item.id === id);
  if (!source) {
    const error = new Error(`Base de conocimiento no encontrada: ${id}`);
    error.status = 404;
    throw error;
  }
  if (!(await pathExists(source.path))) {
    const error = new Error(`La carpeta de la base de conocimiento no existe: ${source.path}`);
    error.status = 410;
    throw error;
  }
  return source;
}

export async function touchSource(id) {
  const sources = await readRegistry();
  const source = sources.find((item) => item.id === id);
  if (source) {
    source.lastUsed = new Date().toISOString();
    await writeRegistry(sources);
  }
  return source;
}

async function looksLikeKddFolder(dir) {
  if (await pathExists(path.join(dir, SOURCE_META_FILE))) return true;
  if (await pathExists(path.join(dir, "specs"))) return true;
  return false;
}

/** Registra una carpeta existente (creada por Doriath, KDD Studio o a mano). */
export async function addExistingSource(dir, { name, description } = {}) {
  const resolved = path.resolve(String(dir || "").trim());
  if (!resolved || !(await pathExists(resolved))) throw Object.assign(new Error(`La carpeta no existe: ${resolved}`), { status: 400 });
  const sources = await readRegistry();
  const duplicate = sources.find((item) => path.resolve(item.path).toLowerCase() === resolved.toLowerCase());
  if (duplicate) return { source: duplicate, created: false };
  await assertSourcePathIsSeparate(resolved);
  const meta = await readSourceMeta(resolved);
  const isKdd = await looksLikeKddFolder(resolved);
  const sourceId = meta?.sourceId || nextSourceId(sources);
  const entry = {
    id: randomUUID(),
    name: name || meta?.name || path.basename(resolved),
    description: description || meta?.description || "",
    path: resolved,
    sourceId: String(sourceId).toUpperCase(),
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    initialized: isKdd,
  };
  await getSpecStore(resolved).ensureLayout();
  if (!meta) await writeSourceMeta(resolved, { name: entry.name, sourceId: entry.sourceId, description: entry.description, createdBy: "doriath", createdAt: entry.createdAt });
  sources.push(entry);
  await writeRegistry(sources);
  return { source: entry, created: true };
}

/** Crea una base de conocimiento nueva dentro de `parentDir` (o de la carpeta por defecto). */
export async function createSource({ name, description = "", parentDir, sourceId }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw Object.assign(new Error("Indica un nombre para la base de conocimiento."), { status: 400 });
  const base = parentDir ? path.resolve(parentDir) : getConfig().paths.knowledgeBases;
  const dir = path.join(base, slugify(cleanName, 40));
  await assertSourcePathIsSeparate(dir);
  if (await pathExists(dir) && (await readdir(dir)).length) {
    throw Object.assign(new Error(`La carpeta ${dir} ya existe y no está vacía.`), { status: 409 });
  }
  const sources = await readRegistry();
  const finalSourceId = String(sourceId || nextSourceId(sources)).toUpperCase();
  if (!/^S\d{3,}$/.test(finalSourceId)) throw Object.assign(new Error("El Source ID debe tener el formato S### (por ejemplo S001)."), { status: 400 });
  await ensureDir(dir);
  for (const { dir: layerDir } of allLayerFolders(dir)) await ensureDir(layerDir);
  await ensureDir(documentsDir(dir));
  const store = getSpecStore(dir);
  await store.ensureLayout();
  await writeSourceMeta(dir, { name: cleanName, sourceId: finalSourceId, description, createdBy: "doriath", createdAt: new Date().toISOString() });
  await writeText(path.join(dir, "README.md"), `# ${cleanName}\n\nBase de conocimiento KDD (${finalSourceId}) creada con Doriath.\n\n- \`specs/\`: especificaciones por capa (Knowledge, Work, Governance).\n- \`docs-tecnicos/\`: documentos importados.\n- \`.kdd-studio/\`: cachés derivadas (se pueden borrar).\n`);
  const entry = {
    id: randomUUID(),
    name: cleanName,
    description,
    path: dir,
    sourceId: finalSourceId,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    initialized: true,
  };
  sources.push(entry);
  await writeRegistry(sources);
  return entry;
}

export async function updateSource(id, patch) {
  const sources = await readRegistry();
  const source = sources.find((item) => item.id === id);
  if (!source) throw Object.assign(new Error("Base de conocimiento no encontrada."), { status: 404 });
  if (patch.name) source.name = String(patch.name).trim();
  if (patch.description !== undefined) source.description = String(patch.description);
  if (patch.sourceId && /^S\d{3,}$/i.test(patch.sourceId)) source.sourceId = String(patch.sourceId).toUpperCase();
  await writeRegistry(sources);
  if (await pathExists(source.path)) {
    const meta = (await readSourceMeta(source.path)) || {};
    await writeSourceMeta(source.path, { ...meta, name: source.name, sourceId: source.sourceId, description: source.description });
  }
  return source;
}

/** Quita la caja del registro. Nunca borra la carpeta. */
export async function removeSource(id) {
  const sources = await readRegistry();
  const index = sources.findIndex((item) => item.id === id);
  if (index < 0) return false;
  const [removed] = sources.splice(index, 1);
  await writeRegistry(sources);
  dropSpecStore(removed.path);
  return true;
}

export async function sourceContext(id) {
  const source = await getSource(id);
  const store = await getSpecStore(source.path).load();
  return { source, store };
}
