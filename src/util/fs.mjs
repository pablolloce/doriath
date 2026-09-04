import { access, mkdir, readFile, writeFile, rename, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target) {
  await mkdir(target, { recursive: true });
  return target;
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`No se pudo leer ${file}: ${error.message}`);
  }
}

/** Escritura atómica: fichero temporal + rename, para que un corte no deje JSON a medias. */
export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, file);
}

export async function writeText(file, text) {
  await ensureDir(path.dirname(file));
  await writeFile(file, text, "utf8");
}

/**
 * Limpia una ruta escrita o pegada a mano. "Copiar como ruta de acceso" de Windows la envuelve en
 * comillas, y esas comillas acababan formando parte del nombre de la carpeta: la ruta existía y
 * KDD Studio decía que no. También se quitan espacios, el prefijo file:// y las barras sobrantes.
 */
export function normalizeUserPath(value) {
  let text = String(value ?? "").trim();
  if (!text) return "";
  // file:///C:/KDD Studio -> C:/KDD Studio, pero file:///home/ana -> /home/ana (la barra inicial es la raíz).
  text = text.replace(/^file:\/\//i, "").replace(/^\/([A-Za-z]:)/, "$1");
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/^[\u200e\u200f\u202a-\u202e]+|[\u200e\u200f\u202a-\u202e]+$/g, "");
  // Una barra final sobra, salvo en la raíz de una unidad ("C:\") o del sistema de ficheros.
  if (text.length > 3 && /[\\/]$/.test(text) && !/^[A-Za-z]:[\\/]$/.test(text)) text = text.replace(/[\\/]+$/, "");
  return text;
}

/**
 * true si `child` es la misma carpeta que `parent` o está dentro de ella. Comparación insensible a
 * mayúsculas (como el sistema de ficheros de Windows, la plataforma de destino de KDD Studio).
 */
export function isPathWithin(child, parent) {
  const a = path.resolve(String(child || "")).toLowerCase();
  const b = path.resolve(String(parent || "")).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const rel = path.relative(b, a);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function listFiles(dir, { extensions, recursive = false } = {}) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive && !entry.name.startsWith(".")) out.push(...await listFiles(full, { extensions, recursive }));
      continue;
    }
    if (!extensions || extensions.includes(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

export async function fileStat(target) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

export function safeFileName(name, fallback = "fichero") {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

export function slugify(value, max = 60) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "item";
}
