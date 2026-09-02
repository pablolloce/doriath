import { readFile } from "node:fs/promises";
import path from "node:path";
import { paths } from "../../paths.mjs";
import { logoDataUri, plainText } from "./brand.mjs";

function escapeHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Markdown mínimo a HTML (encabezados, listas, negrita, cursiva, código, tablas simples, párrafos). */
export function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let list = null;
  let inCode = false;
  let table = null;
  const inline = (text) => escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeTable = () => { if (table) { out.push("</tbody></table>"); table = null; } };
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) { out.push("</code></pre>"); inCode = false; } else { closeList(); closeTable(); out.push("<pre><code>"); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { closeList(); closeTable(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (/^\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      if (!table) { closeList(); table = true; out.push(`<table><thead><tr>${cells.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>`); continue; }
      out.push(`<tr>${cells.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`);
      continue;
    }
    closeTable();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const tag = bullet ? "ul" : "ol";
      if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline((bullet || numbered)[1].replace(/^\[[ xX]\]\s*/, ""))}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    if (/^>\s?/.test(line)) { out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  closeTable();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

/** Documento HTML autocontenido con tokens BBVA (fuentes por Google Fonts con fallback). */
export async function buildHtmlDocument({ title, subtitle, markdown, html, kicker = "BBVA CIB" }) {
  const tokens = await readFile(path.join(paths.brandDir, "tokens.css"), "utf8").catch(() => "");
  const bbva = await logoDataUri("bbva-electric.png");
  const nfq = await logoDataUri("nfq-black.png");
  const body = html || markdownToHtml(markdown);
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(plainText(title))}</title>
<style>
${tokens}
body { background: var(--bbva-sand); color: var(--bbva-midnight); }
.doc { max-width: 960px; margin: 0 auto; padding: 48px 40px 80px; }
.doc__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
.doc__kicker { font-family: var(--bbva-font-body); font-weight: 700; font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: var(--bbva-gray-5); }
.doc h1 { font-family: var(--bbva-font-display); font-size: 44px; line-height: 1.05; color: var(--bbva-electric-blue); margin: 8px 0 12px; }
.doc h2 { font-size: 28px; color: var(--bbva-electric-blue); margin: 40px 0 12px; }
.doc h3 { font-size: 20px; color: var(--bbva-electric-blue); margin: 28px 0 8px; }
.doc p, .doc li { font-size: 16px; line-height: 1.55; }
.doc__subtitle { font-size: 18px; color: var(--bbva-gray-5); margin-bottom: 24px; }
.doc table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; background: #fff; border-radius: 16px; overflow: hidden; }
.doc th { background: var(--bbva-electric-blue); color: #fff; text-align: left; padding: 10px 14px; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
.doc td { padding: 10px 14px; border-bottom: 1px solid var(--bbva-gray-3); font-size: 15px; }
.doc pre { background: #fff; border: 1px solid var(--bbva-gray-2); border-radius: 16px; padding: 16px 20px; overflow-x: auto; font-size: 13px; }
.doc blockquote { background: var(--bbva-serene-blue); color: var(--bbva-electric-blue); border-radius: 16px; padding: 20px 28px; font-family: var(--bbva-font-display); font-size: 20px; font-weight: 700; margin: 24px 0; }
.doc__footer { margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--bbva-gray-3); display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--bbva-gray-5); text-transform: uppercase; letter-spacing: .05em; }
</style>
</head>
<body>
<article class="doc">
  <header class="doc__header">
    <span class="doc__kicker">${escapeHtml(kicker)}</span>
    <img src="${bbva}" alt="BBVA" style="height:40px">
  </header>
  <h1>${escapeHtml(plainText(title))}</h1>
  ${subtitle ? `<p class="doc__subtitle">${escapeHtml(plainText(subtitle))}</p>` : ""}
  ${body}
  <footer class="doc__footer"><span>Hecho por</span><img src="${nfq}" alt="NFQ" style="height:22px"></footer>
</article>
</body>
</html>`;
}
