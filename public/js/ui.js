/** Utilidades de interfaz: creación de nodos, markdown, avisos, modales, selección de carpetas. */
import { get, post } from "./api.js";

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Markdown básico (encabezados, listas, tablas, código, énfasis, enlaces, citas, checkboxes). */
export function markdown(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let list = null;
  let inCode = false;
  let table = null;
  let paragraph = [];
  const inline = (value) => escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+|\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)((?:ARCH|DOM|PROD|FEAT|DOC|WRK-SPEC|WRK-PLAN|WRK-TASK|ADR|RFC|RULE)-[A-Z0-9-]*\d{3,})\b/g, '$1<code class="spec-ref">$2</code>');
  const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`); paragraph = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeTable = () => { if (table) { out.push("</tbody></table>"); table = null; } };
  for (const line of lines) {
    if (/^```/.test(line)) {
      flushParagraph(); closeList(); closeTable();
      if (inCode) out.push("</code></pre>"); else out.push("<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(`${escapeHtml(line)}\n`); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { flushParagraph(); closeList(); closeTable(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushParagraph(); closeList(); closeTable(); out.push("<hr>"); continue; }
    if (/^\|.*\|\s*$/.test(line)) {
      flushParagraph(); closeList();
      const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      if (!table) { table = true; out.push(`<table><thead><tr>${cells.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>`); continue; }
      out.push(`<tr>${cells.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`);
      continue;
    }
    closeTable();
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
      let item = (bullet || numbered)[1];
      const check = /^\[([ xX])\]\s*(.*)$/.exec(item);
      if (check) item = `<input type="checkbox" disabled ${check[1] !== " " ? "checked" : ""}>${check[2]}`;
      out.push(`<li>${check ? item.replace(check[2], inline(check[2])) : inline(item)}</li>`);
      continue;
    }
    closeList();
    if (/^>\s?/.test(line)) { flushParagraph(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); continue; }
    if (!line.trim()) { flushParagraph(); continue; }
    paragraph.push(line);
  }
  flushParagraph(); closeList(); closeTable();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

export function md(text, cls = "md") {
  return h("div", { class: cls, html: markdown(text) });
}

export function toast(message, kind = "info", ms = 4200) {
  const container = document.getElementById("toasts");
  const node = h("div", { class: `toast toast--${kind}`, text: message });
  container.append(node);
  setTimeout(() => node.remove(), ms);
}

export function fmtDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtBytes(size) {
  const value = Number(size) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------- Modales ---------- */
// Un modal puede abrir otro encima (por ejemplo, el selector de carpetas desde "Gestionar bases de
// conocimiento" o desde "Ajustes"). En vez de sustituir el contenido del overlay -y perder el modal de
// debajo, con el formulario a medio rellenar-, el de abajo se aparta (sin destruirlo) y vuelve a
// mostrarse tal cual estaba en cuanto se cierra el de arriba. Solo cuando se cierra el último de la
// pila se oculta el overlay.
const modalStack = [];

export function openModal(content, { wide = false, onClose } = {}) {
  const overlay = document.getElementById("overlay");
  const modal = h("div", { class: `modal${wide ? " modal--wide" : ""}` }, content);
  overlay.hidden = false;
  overlay.replaceChildren(modal);
  modalStack.push(modal);
  const close = () => {
    const index = modalStack.indexOf(modal);
    if (index === -1) return;
    modalStack.splice(index, 1);
    const previous = modalStack.at(-1);
    if (previous) {
      overlay.replaceChildren(previous);
      overlay.onclick = (event) => { if (event.target === overlay) previous.__close(); };
    } else {
      overlay.hidden = true;
      overlay.replaceChildren();
    }
    onClose?.();
  };
  modal.__close = close;
  overlay.onclick = (event) => { if (event.target === overlay) close(); };
  return { close, modal };
}

export function modalHeader(title, close, subtitle) {
  return h("div", { class: "modal__header" },
    h("div", {}, subtitle ? h("p", { class: "ante-title", text: subtitle }) : null, h("h2", { text: title })),
    h("button", { class: "btn btn--ghost btn--sm", text: "Cerrar", onclick: close }));
}

export function confirmDialog(title, message, { okLabel = "Confirmar", danger = false } = {}) {
  return new Promise((resolve) => {
    const { close } = openModal([], { onClose: () => resolve(false) });
    const node = h("div", { class: "modal__body" },
      modalHeader(title, () => { close(); resolve(false); }),
      h("p", { class: "lead", text: message }),
      h("div", { class: "card__actions", style: { justifyContent: "flex-end", marginTop: "16px" } },
        h("button", { class: "btn btn--outline", text: "Cancelar", onclick: () => { close(); resolve(false); } }),
        h("button", { class: `btn ${danger ? "btn--danger" : ""}`, text: okLabel, onclick: () => { resolve(true); close(); } })));
    document.querySelector(".modal").append(node);
  });
}

export function promptDialog(title, { label = "Valor", value = "", placeholder = "", multiline = false, okLabel = "Aceptar" } = {}) {
  return new Promise((resolve) => {
    const { close } = openModal([], { onClose: () => resolve(null) });
    const input = multiline ? h("textarea", { class: "textarea", placeholder, text: value }) : h("input", { class: "input", value, placeholder });
    const node = h("div", {},
      modalHeader(title, () => { close(); resolve(null); }),
      h("div", { class: "field" }, h("label", { text: label }), input),
      h("div", { class: "card__actions", style: { justifyContent: "flex-end", marginTop: "16px" } },
        h("button", { class: "btn btn--outline", text: "Cancelar", onclick: () => { close(); resolve(null); } }),
        h("button", { class: "btn", text: okLabel, onclick: () => { const result = input.value; resolve(result); close(); } })));
    document.querySelector(".modal").append(node);
    setTimeout(() => input.focus(), 30);
  });
}

/**
 * Selección de carpeta. El explorador propio de Doriath es el camino principal porque funciona
 * siempre: el diálogo nativo de Windows depende de PowerShell y de que la ventana llegue a primer
 * plano, y en equipos con la política restringida no llega a aparecer, dejando al usuario delante de
 * un botón que no hace nada. Queda como atajo opcional dentro del propio explorador.
 */
export function pickFolder({ title = "Selecciona una carpeta", initial = "" } = {}) {
  return browseFolder({ title, initial });
}

export function browseFolder({ title = "Selecciona una carpeta", initial = "" } = {}) {
  return new Promise((resolve) => {
    const { close } = openModal([], { onClose: () => resolve(null) });
    const current = h("input", { class: "input mono", value: initial, placeholder: "C:\\Doriath\\knowledge-bases\\mi-base" });
    const list = h("div", { class: "dir-browser" });
    const nativeButton = h("button", { class: "btn btn--outline btn--sm", text: "Selector de Windows", title: "Abre el diálogo del sistema. Si no aparece, búscalo en la barra de tareas.", onclick: async () => {
      nativeButton.disabled = true;
      nativeButton.textContent = "Abriendo…";
      try {
        const native = await post("/api/dialog/folder", { title, initial: current.value });
        if (!native.supported) toast("El selector del sistema no está disponible en este equipo; usa el explorador de aquí abajo.", "info", 6000);
        else if (native.path) { current.value = native.path; load(native.path); }
      } catch (error) {
        toast(error.message, "error");
      }
      nativeButton.disabled = false;
      nativeButton.textContent = "Selector de Windows";
    } });
    const load = async (target) => {
      list.replaceChildren(h("div", { class: "muted small", text: "Cargando…" }));
      try {
        const data = await get(`/api/fs/list?path=${encodeURIComponent(cleanPath(target) || "")}`);
        current.value = data.path || "";
        list.replaceChildren(
          data.parent ? h("div", { class: "dir-browser__item", text: "⬑ Subir un nivel", onclick: () => load(data.parent) }) : null,
          ...data.entries.filter((entry) => !entry.hidden).map((entry) => h("div", { class: "dir-browser__item", text: `📁 ${entry.name}`, onclick: () => load(entry.path) })),
        );
      } catch (error) {
        list.replaceChildren(h("div", { class: "callout callout--error", text: error.message }));
      }
    };
    const node = h("div", {},
      modalHeader(title, () => { close(); resolve(null); }, "Explorador de carpetas"),
      h("p", { class: "small muted", text: "Navega hasta la carpeta, o pega la ruta y pulsa Ir. Puedes pegarla tal cual la copies de Windows, con comillas incluidas." }),
      h("div", { class: "field" }, h("label", { text: "Ruta" }), h("div", { class: "form-row" }, current,
        h("button", { class: "btn btn--outline btn--sm", text: "Ir", onclick: () => load(current.value) }),
        nativeButton)),
      list,
      h("div", { class: "card__actions", style: { justifyContent: "flex-end", marginTop: "16px" } },
        h("button", { class: "btn btn--outline", text: "Cancelar", onclick: () => { close(); resolve(null); } }),
        h("button", { class: "btn", text: "Usar esta carpeta", onclick: () => { resolve(cleanPath(current.value)); close(); } })));
    document.querySelector(".modal").append(node);
    load(initial);
  });
}

/** Misma limpieza que en el servidor: comillas de "Copiar como ruta de acceso", espacios y barra final. */
export function cleanPath(value) {
  let text = String(value ?? "").trim();
  if (!text) return "";
  text = text.replace(/^file:\/\//i, "").replace(/^\/([A-Za-z]:)/, "$1");
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1).trim();
  if (text.length > 3 && /[\\/]$/.test(text) && !/^[A-Za-z]:[\\/]$/.test(text)) text = text.replace(/[\\/]+$/, "");
  return text;
}

export function statusChip(status) {
  const map = { draft: "chip--canary", active: "chip--lime", completed: "chip--lime", accepted: "chip--lime", deprecated: "chip--mandarin", archived: "chip--outline", rejected: "chip--mandarin", proposed: "chip--ice", discussion: "chip--ice", running: "chip--canary", review: "chip--serene", committed: "chip--lime", failed: "chip--mandarin", pending: "chip--outline", cancelled: "chip--outline", "no-changes": "chip--outline", preview: "chip--serene", confirmed: "chip--lime" };
  return h("span", { class: `chip ${map[status] || ""}`, text: status || "—" });
}

export function confidenceChip(confidence) {
  const map = { high: "chip--lime", medium: "chip--canary", low: "chip--outline" };
  const label = { high: "confianza alta", medium: "confianza media", low: "confianza baja" };
  return h("span", { class: `chip ${map[confidence] || "chip--outline"}`, text: label[confidence] || confidence || "" });
}

export function layerChip(layer, label) {
  const map = { architecture: "chip--purple", domain: "chip--serene", product: "chip--ice", feature: "chip--lime", doc: "chip--outline", "work-spec": "chip--canary", "work-plan": "chip--canary", "work-task": "chip--canary", adr: "chip--mandarin", rfc: "chip--mandarin", rule: "chip--mandarin" };
  return h("span", { class: `chip ${map[layer] || ""}`, text: label || layer });
}

export function renderDiff(diff) {
  const lines = String(diff || "").split("\n").map((line) => {
    const cls = line.startsWith("+++") || line.startsWith("---") ? "file" : line.startsWith("diff --git") ? "file" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
    return `<div class="${cls}">${escapeHtml(line) || " "}</div>`;
  });
  return h("div", { class: "diff", html: lines.join("") });
}

export function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(240, textarea.scrollHeight)}px`;
}
