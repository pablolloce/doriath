import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Extracción de texto de documentos para el analizador. Mismos formatos que KDD Studio salvo OCR de
 * escaneados (fuera de la primera versión): PDF, DOCX, XLSX, PPTX, Markdown, TXT, CSV, SQL, código.
 * Devuelve texto plano con marcadores de sección (`§`) para que las fases del analizador puedan
 * rebanar el documento por secciones.
 */
export const DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".xlsm", ".pptx", ".md", ".markdown", ".txt", ".csv", ".sql", ".json", ".yaml", ".yml", ".xml", ".html", ".htm"];
export const CODE_EXTENSIONS = [".java", ".kt", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".cs", ".rb", ".php", ".scala", ".sh", ".ps1", ".properties", ".gradle", ".cfg", ".conf", ".toml", ".ini", ".proto", ".graphql", ".vue", ".svelte", ".css", ".scss"];
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

export function isSupportedDocument(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return DOCUMENT_EXTENSIONS.includes(ext) || CODE_EXTENSIONS.includes(ext) || IMAGE_EXTENSIONS.includes(ext);
}

async function extractPdf(buffer) {
  const pdfParse = require("pdf-parse/lib/pdf-parse.js");
  const pages = [];
  const result = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      let lastY = null;
      let text = "";
      for (const item of content.items) {
        const y = item.transform?.[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
        else if (text && !text.endsWith(" ")) text += " ";
        text += item.str;
        lastY = y;
      }
      pages.push(text);
      return text;
    },
  });
  const body = pages.length ? pages.map((page, index) => `§ Página ${index + 1}\n${page.trim()}`).join("\n\n") : result.text;
  return { text: body, pages: pages.length || result.numpages, info: result.info || {} };
}

async function extractDocx(buffer) {
  const mammoth = require("mammoth");
  const result = await mammoth.convertToMarkdown({ buffer });
  const warnings = (result.messages || []).map((message) => message.message);
  return { text: String(result.value).replace(/\\([.\-_*#()\[\]])/g, "$1"), warnings };
}

async function extractXlsx(buffer) {
  const XLSX = require("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const parts = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    parts.push(`§ Hoja: ${name}\n${csv.trim()}`);
  }
  return { text: parts.join("\n\n"), sheets: workbook.SheetNames };
}

function decodeXmlEntities(text) {
  return String(text)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

async function extractPptx(buffer) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/slide(\d+)/.exec(a)[1]) - Number(/slide(\d+)/.exec(b)[1]));
  const parts = [];
  for (const file of slideFiles) {
    const xml = await zip.file(file).async("string");
    const paragraphs = [];
    for (const paragraph of xml.split(/<\/a:p>/)) {
      const runs = [...paragraph.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((match) => decodeXmlEntities(match[1]));
      const line = runs.join("").trim();
      if (line) paragraphs.push(line);
    }
    const number = /slide(\d+)/.exec(file)[1];
    parts.push(`§ Diapositiva ${number}\n${paragraphs.join("\n")}`);
    const notesFile = `ppt/notesSlides/notesSlide${number}.xml`;
    if (zip.file(notesFile)) {
      const notesXml = await zip.file(notesFile).async("string");
      const notes = [...notesXml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((match) => decodeXmlEntities(match[1])).join(" ").trim();
      if (notes) parts.push(`Notas de la diapositiva ${number}: ${notes}`);
    }
  }
  return { text: parts.join("\n\n"), slides: slideFiles.length };
}

function extractHtml(text) {
  return String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Extrae el texto de un fichero. `buffer` opcional (si no, se lee de `filePath`).
 */
export async function extractDocumentText(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  const data = buffer || await readFile(filePath);
  let result;
  if (ext === ".pdf") result = await extractPdf(data);
  else if (ext === ".docx") result = await extractDocx(data);
  else if (ext === ".xlsx" || ext === ".xlsm") result = await extractXlsx(data);
  else if (ext === ".pptx") result = await extractPptx(data);
  else if (ext === ".html" || ext === ".htm") result = { text: extractHtml(data.toString("utf8")) };
  else if (IMAGE_EXTENSIONS.includes(ext)) result = { text: "", image: true, warnings: ["Las imágenes se adjuntan al modelo cuando este es multimodal; no se extrae texto."] };
  else result = { text: data.toString("utf8") };
  const text = normalizeText(result.text || "");
  return { ...result, text, chars: text.length, ext };
}

export function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/**
 * Divide el texto en secciones por encabezados Markdown, marcadores `§` o títulos numerados
 * ("3.2 Título"), para rebanar el documento en la fase de generación.
 */
export function splitDocumentSections(text) {
  const lines = String(text || "").split("\n");
  const sections = [];
  let current = { title: "Inicio", lines: [] };
  const headingPattern = /^(?:#{1,6}\s+.+|§\s*.+|(?:\d+\.){1,3}\d*\s+[A-ZÁÉÍÓÚÑ].{2,80}|[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 ,.:/-]{6,70})$/;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && headingPattern.test(trimmed) && trimmed.length < 90) {
      if (current.lines.length) sections.push(current);
      current = { title: trimmed.replace(/^#+\s*/, "").replace(/^§\s*/, ""), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length) sections.push(current);
  return sections.map((section, index) => ({ index, title: section.title, text: section.lines.join("\n").trim() })).filter((section) => section.text || section.index === 0);
}

/** Corta un texto largo en trozos de tamaño máximo respetando límites de sección/párrafo. */
export function chunkText(text, maxChars = 60000) {
  const sections = splitDocumentSections(text);
  const chunks = [];
  let current = "";
  for (const section of sections) {
    const block = `§ ${section.title}\n${section.text}\n\n`;
    if (block.length > maxChars) {
      if (current) { chunks.push(current); current = ""; }
      for (let offset = 0; offset < block.length; offset += maxChars) chunks.push(block.slice(offset, offset + maxChars));
      continue;
    }
    if ((current + block).length > maxChars) {
      chunks.push(current);
      current = block;
    } else {
      current += block;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.length ? chunks : [String(text || "")];
}
