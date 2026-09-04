import { createRequire } from "node:module";
import { plainText } from "./brand.mjs";

const require = createRequire(import.meta.url);

/**
 * Libro Excel a partir de { title, sheets: [{ name, headers[], rows[][], widths[] }] }.
 * SheetJS (edición comunitaria) no escribe estilos de celda, así que la identidad se refleja en la
 * estructura: fila de título, cabeceras en mayúsculas, anchos y una hoja "Acerca de" con la autoría.
 */
export function buildXlsx(model) {
  const XLSX = require("xlsx");
  const workbook = XLSX.utils.book_new();
  const sheets = Array.isArray(model.sheets) && model.sheets.length ? model.sheets : [{ name: "Datos", headers: model.headers || [], rows: model.rows || [] }];
  for (const sheet of sheets) {
    const headers = (sheet.headers || []).map((header) => plainText(header).toUpperCase());
    const rows = (sheet.rows || []).map((row) => (Array.isArray(row) ? row.map((cell) => (typeof cell === "number" ? cell : plainText(cell))) : Object.values(row || {})));
    const data = [];
    if (sheet.title || model.title) {
      data.push([plainText(sheet.title || model.title)]);
      data.push([]);
    }
    if (headers.length) data.push(headers);
    data.push(...rows);
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const widths = (sheet.widths || headers.map((header, index) => Math.min(60, Math.max(header.length + 4, ...rows.map((row) => String(row[index] ?? "").length + 2)))));
    worksheet["!cols"] = widths.map((width) => ({ wch: Number(width) || 14 }));
    if (headers.length) worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: data.length - rows.length - 1, c: 0 }, e: { r: data.length - 1, c: Math.max(0, headers.length - 1) } }) };
    XLSX.utils.book_append_sheet(workbook, worksheet, String(sheet.name || "Datos").slice(0, 31));
  }
  const about = XLSX.utils.aoa_to_sheet([["Documento", plainText(model.title || "")], ["Generado por", "KDD Studio · NFQ para BBVA CIB"], ["Fecha", new Date().toISOString().slice(0, 10)], ["Fuente", plainText(model.source || "Bases de conocimiento KDD")]]);
  about["!cols"] = [{ wch: 18 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(workbook, about, "Acerca de");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
