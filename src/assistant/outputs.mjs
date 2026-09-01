import path from "node:path";
import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import { getConfig } from "../config.mjs";
import { ensureDir, safeFileName, pathExists, slugify } from "../util/fs.mjs";

/**
 * Carpeta de salidas del asistente: `<outputs>/<conversación>/<fichero>`. La UI lista y descarga
 * desde aquí; el usuario también puede abrir la carpeta directamente.
 */
export function outputsRoot() {
  return path.resolve(getConfig().paths.outputs);
}

export function conversationFolder(chat) {
  const name = `${String(chat.createdAt || "").slice(0, 10) || "sin-fecha"}-${slugify(chat.title || chat.id, 40)}`;
  return path.join(outputsRoot(), name);
}

export function resolveOutputPath(relative) {
  const root = outputsRoot();
  const target = path.resolve(root, String(relative || ""));
  if (!target.startsWith(root)) throw Object.assign(new Error("Ruta fuera de la carpeta de salidas."), { status: 403 });
  return target;
}

export async function writeOutput(chat, name, data) {
  const folder = conversationFolder(chat);
  await ensureDir(folder);
  const clean = safeFileName(name, "salida.txt");
  let target = path.join(folder, clean);
  let counter = 1;
  while (await pathExists(target)) {
    const ext = path.extname(clean);
    target = path.join(folder, `${clean.slice(0, clean.length - ext.length)} (${counter})${ext}`);
    counter += 1;
  }
  await writeFile(target, data);
  const relative = path.relative(outputsRoot(), target).split(path.sep).join("/");
  return { name: path.basename(target), path: target, relative, size: Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data)), url: `/api/outputs/download?path=${encodeURIComponent(relative)}` };
}

export async function listOutputs({ folder } = {}) {
  const root = outputsRoot();
  await ensureDir(root);
  const out = [];
  const walk = async (dir, depth) => {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 2) await walk(full, depth + 1);
        continue;
      }
      const info = await stat(full);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (folder && !relative.startsWith(`${folder}/`)) continue;
      out.push({ name: entry.name, folder: path.relative(root, dir).split(path.sep).join("/"), relative, size: info.size, modified: info.mtime.toISOString(), url: `/api/outputs/download?path=${encodeURIComponent(relative)}` });
    }
  };
  await walk(root, 0);
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function deleteOutput(relative) {
  const target = resolveOutputPath(relative);
  await unlink(target);
  return true;
}
