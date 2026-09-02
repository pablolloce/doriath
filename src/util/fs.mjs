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
