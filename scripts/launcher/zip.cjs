"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

/**
 * Lector ZIP mínimo (directorio central + inflateRaw) sin dependencias, para usarlo dentro de los
 * ejecutables SEA (instalador y launcher). Soporta entradas store (0) y deflate (8); ignora cifrado.
 */
function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - 65536); offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error("Fichero ZIP inválido: no se encuentra el directorio central.");
}

function listEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Entrada de directorio central corrupta.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, size, localHeaderOffset, isDirectory: name.endsWith("/"), unixMode: (externalAttributes >>> 16) & 0xffff });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer, entry) {
  const header = entry.localHeaderOffset;
  if (buffer.readUInt32LE(header) !== 0x04034b50) throw new Error(`Cabecera local corrupta en ${entry.name}.`);
  const nameLength = buffer.readUInt16LE(header + 26);
  const extraLength = buffer.readUInt16LE(header + 28);
  const start = header + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Método de compresión no soportado (${entry.method}) en ${entry.name}.`);
}

/**
 * Extrae el ZIP en `destination`. `stripPrefix` elimina un primer segmento de carpeta (p. ej. el
 * `node-v22-win-x64/` de los zips de Node). `filter(name)` permite omitir entradas.
 */
function extractZip(buffer, destination, { stripPrefix = false, filter, onEntry } = {}) {
  const entries = listEntries(buffer);
  let extracted = 0;
  for (const entry of entries) {
    let name = entry.name.replace(/\\/g, "/");
    if (stripPrefix) {
      const slash = name.indexOf("/");
      if (slash < 0) continue;
      name = name.slice(slash + 1);
      if (!name) continue;
    }
    if (filter && !filter(name)) continue;
    if (name.includes("../")) continue;
    const target = path.join(destination, name);
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, readEntry(buffer, entry));
    if (entry.unixMode & 0o111) {
      try { fs.chmodSync(target, 0o755); } catch { /* Windows */ }
    }
    extracted += 1;
    onEntry?.(name, extracted, entries.length);
  }
  return extracted;
}

module.exports = { listEntries, readEntry, extractZip };
