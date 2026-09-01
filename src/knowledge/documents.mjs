import path from "node:path";
import { readdir, stat, writeFile, unlink, readFile } from "node:fs/promises";
import { documentsDir, cacheDir } from "../kdd/layout.mjs";
import { ensureDir, safeFileName, pathExists, writeText } from "../util/fs.mjs";
import { extractDocumentText, isSupportedDocument } from "./extract.mjs";
import { Bm25Index } from "../kdd/search.mjs";

/**
 * Documentos importados a una base de conocimiento. Los originales viven en `docs-tecnicos/` y el
 * texto extraído se cachea en `.kdd-studio/extracted/<nombre>.txt` para búsquedas y para el chat.
 */
function extractedPath(sourceDir, name) {
  return path.join(cacheDir(sourceDir), "extracted", `${name}.txt`);
}

export async function listDocuments(sourceDir) {
  const dir = documentsDir(sourceDir);
  await ensureDir(dir);
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const info = await stat(full);
    const extracted = await pathExists(extractedPath(sourceDir, entry.name));
    out.push({ name: entry.name, path: full, size: info.size, modified: info.mtime.toISOString(), supported: isSupportedDocument(entry.name), extracted });
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function saveDocument(sourceDir, { name, base64, buffer }) {
  const clean = safeFileName(name, "documento");
  if (!isSupportedDocument(clean)) throw Object.assign(new Error(`Formato no soportado: ${path.extname(clean) || clean}`), { status: 400 });
  const dir = documentsDir(sourceDir);
  await ensureDir(dir);
  let target = path.join(dir, clean);
  let counter = 1;
  while (await pathExists(target)) {
    const ext = path.extname(clean);
    target = path.join(dir, `${clean.slice(0, clean.length - ext.length)} (${counter})${ext}`);
    counter += 1;
  }
  const data = buffer || Buffer.from(String(base64 || ""), "base64");
  await writeFile(target, data);
  const extraction = await extractAndCache(sourceDir, path.basename(target), data).catch((error) => ({ error: error.message }));
  return { name: path.basename(target), path: target, size: data.length, extraction: extraction.error ? { error: extraction.error } : { chars: extraction.chars, pages: extraction.pages, warnings: extraction.warnings } };
}

export async function extractAndCache(sourceDir, name, buffer) {
  const file = path.join(documentsDir(sourceDir), name);
  const result = await extractDocumentText(file, buffer);
  await writeText(extractedPath(sourceDir, name), result.text);
  return result;
}

export async function getDocumentText(sourceDir, name) {
  const cached = extractedPath(sourceDir, name);
  if (await pathExists(cached)) return readFile(cached, "utf8");
  const result = await extractAndCache(sourceDir, name);
  return result.text;
}

export async function deleteDocument(sourceDir, name) {
  const file = path.join(documentsDir(sourceDir), safeFileName(name));
  await unlink(file).catch(() => undefined);
  await unlink(extractedPath(sourceDir, name)).catch(() => undefined);
  return true;
}

/** Índice BM25 de documentos por párrafo, para `search_document` del asistente. */
export async function buildDocumentIndex(sourceDir) {
  const index = new Bm25Index();
  const documents = await listDocuments(sourceDir);
  for (const document of documents) {
    if (!document.supported) continue;
    let text = "";
    try {
      text = await getDocumentText(sourceDir, document.name);
    } catch {
      continue;
    }
    const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 40);
    paragraphs.forEach((paragraph, position) => {
      index.add(`${document.name}#${position}`, { body: { text: paragraph } }, { document: document.name, position, text: paragraph });
    });
  }
  return index;
}
