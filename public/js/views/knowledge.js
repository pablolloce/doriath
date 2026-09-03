/** Knowledge Base Studio: documentos, análisis con preview, specs, grafo, chat de creación y pendientes. */
import { get, post, put, del, subscribe, readFileAsBase64 } from "../api.js";
import { h, md, clear, toast, confirmDialog, promptDialog, fmtDate, fmtBytes, statusChip, confidenceChip, layerChip, openModal, modalHeader } from "../ui.js";
import { createChatView } from "../chat.js";
import { renderPackagePanel } from "../package-panel.js";
import { setBreadcrumb, activeSource, refreshSources, openSourcesManager, kbPicker, state as appState } from "../app.js";

const TABS = [["dashboard", "Panel"], ["documents", "Documentos"], ["analyses", "Análisis"], ["specs", "Specs"], ["graph", "Grafo"], ["governance", "Gobernanza"], ["activity", "Actividad"], ["create", "Crear specs"], ["pending", "Pendientes"]];
const GOVERNANCE_LAYERS = ["adr", "rfc", "rule"];
const ACTIVITY_LABELS = { import: "Importación", analysis: "Análisis", edit: "Edición", chat: "Corrección desde el chat", governance: "Gobernanza" };
const initials = (name) => String(name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

export async function renderKnowledge({ container, params, state }) {
  const source = activeSource();
  setBreadcrumb("Knowledge Bases Studio", source?.name);
  container.append(kbPicker({ expert: true, label: "Base de conocimiento sobre la que trabajas" }));
  if (!source) {
    container.append(h("div", { class: "card card--electric" },
      h("p", { class: "ante-title", text: "Knowledge Bases Studio" }),
      h("h1", { text: "Empieza con una base de conocimiento" }),
      h("p", { class: "lead", style: { marginTop: "12px" }, text: "Añade una carpeta KDD existente o crea una nueva. Cada base de conocimiento guarda documentos importados y las specs que se generan a partir de ellos." }),
      h("div", { class: "card__actions", style: { marginTop: "20px" } }, h("button", { class: "btn btn--accent", text: "Gestionar bases de conocimiento", onclick: openSourcesManager }))));
    return {};
  }
  let tab = params[0] || localStorage.getItem("doriath.kbTab") || "dashboard";
  const layers = state.layers || [];
  const labelFor = (layer) => layers.find((item) => item.id === layer)?.label || layer;
  const overviewNode = h("div", { class: "bento bento--4" });
  const tabsNode = h("div", { class: "tabs" });
  const body = h("div");
  container.append(
    h("div", { class: "card card--electric" },
      h("div", { class: "card__header" },
        h("div", {}, h("p", { class: "ante-title", text: `Base de conocimiento · ${source.sourceId}` }), h("h1", { text: source.name }), source.description ? h("p", { class: "small", style: { marginTop: "6px", opacity: 0.85 }, text: source.description }) : null),
        h("div", { class: "card__actions" }, h("button", { class: "btn btn--accent btn--sm", text: "Abrir carpeta", onclick: () => post("/api/open", { path: source.path }).catch((error) => toast(error.message, "error")) }))),
      overviewNode),
    tabsNode,
    body,
  );

  let cleanup = null;

  async function loadOverview() {
    try {
      const data = await get(`/api/sources/${source.id}/overview`);
      clear(overviewNode);
      const stat = (value, label) => h("div", { class: "stat" }, h("span", { class: "stat__value", text: value }), h("span", { class: "stat__label", text: label }));
      overviewNode.append(stat(data.stats.specs, "specs"), stat(data.stats.relations, "relaciones"), stat(data.documents, "documentos"), stat(data.pending + data.issues.length + data.problems.length, "pendientes e incidencias"));
    } catch (error) {
      overviewNode.append(h("div", { class: "callout callout--error", text: error.message }));
    }
  }

  function renderTabs() {
    clear(tabsNode);
    for (const [id, label] of TABS) tabsNode.append(h("button", { class: `tab${tab === id ? " is-active" : ""}`, text: label, onclick: () => selectTab(id) }));
  }

  async function selectTab(id, extra) {
    tab = id;
    localStorage.setItem("doriath.kbTab", id);
    renderTabs();
    cleanup?.();
    cleanup = null;
    clear(body);
    const renderers = { dashboard: renderDashboard, documents: renderDocuments, analyses: renderAnalyses, specs: renderSpecs, graph: renderGraph, governance: renderGovernance, activity: renderActivity, create: renderCreate, pending: renderPending };
    try {
      cleanup = await renderers[id](body, extra);
    } catch (error) {
      body.append(h("div", { class: "callout callout--error", text: error.message }));
    }
  }

  /* ---------- Panel: salud, reparto por capa y últimos documentos ---------- */
  async function renderDashboard(node) {
    const [overview, graph, activity, documents] = await Promise.all([
      get(`/api/sources/${source.id}/overview`),
      get(`/api/sources/${source.id}/graph`),
      get(`/api/sources/${source.id}/activity?limit=6`).catch(() => ({ entries: [] })),
      get(`/api/sources/${source.id}/documents`).catch(() => ({ documents: [] })),
    ]);
    const specs = await get(`/api/sources/${source.id}/specs`).then((data) => data.specs).catch(() => []);
    const counts = {};
    for (const spec of specs) counts[spec.layer] = (counts[spec.layer] || 0) + 1;
    const max = Math.max(1, ...Object.values(counts));
    const issues = [...(overview.issues || []), ...(overview.problems || []).map((problem) => ({ level: "error", id: problem.file || "", message: problem.error || String(problem) }))];
    const errors = issues.filter((issue) => issue.level === "error" || issue.severity === "error").length;
    const warnings = issues.length - errors;
    const score = Math.max(40, 100 - errors * 12 - warnings * 4);

    node.append(
      h("div", { class: "bento bento--4" },
        statCard(overview.stats.specs, "specs totales", "card--serene"),
        statCard(specs.filter((spec) => spec.status === "active").length, "activas", "card--lime"),
        statCard(specs.filter((spec) => spec.status === "draft").length, "borradores", "card--canary"),
        statCard(overview.pending, "preguntas pendientes", "card--ice")),
      h("div", { class: "bento bento--main-aside", style: { marginTop: "16px" } },
        h("div", { class: "card" },
          h("p", { class: "ante-title", text: "Reparto por capa" }),
          h("h2", { text: "Composición de la base" }),
          h("div", { style: { marginTop: "16px" } }, Object.keys(counts).sort().map((layer) => h("div", { class: "bar-row" },
            h("span", { class: "mono", text: (state.layers?.find((item) => item.id === layer)?.prefix) || layer.toUpperCase().slice(0, 5) }),
            h("div", { class: "bar" }, h("span", { style: { width: `${(counts[layer] / max) * 100}%`, background: layerColor(layer) } })),
            h("b", { text: String(counts[layer]) })))),
          overview.stats.relations ? h("p", { class: "small muted", style: { marginTop: "12px" }, text: `${overview.stats.relations} relaciones entre specs. Abre la pestaña Grafo para verlas.` }) : null),
        h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
          h("div", { class: "card" },
            h("p", { class: "ante-title", text: "Salud de la base" }),
            h("div", { class: "health" }, h("span", { class: "health__score", text: String(score) }), h("span", { class: "muted", text: "/ 100" })),
            h("div", { class: "chips", style: { margin: "10px 0 14px" } },
              h("span", { class: "chip chip--mandarin", text: `${errors} errores` }),
              h("span", { class: "chip chip--canary", text: `${warnings} avisos` })),
            issues.length
              ? h("div", { class: "list" }, issues.slice(0, 5).map((issue) => h("div", { class: "list-item is-clickable", onclick: () => issue.id && selectTab("specs", issue.id) },
                h("div", { class: "list-item__main" }, h("div", { class: "list-item__title mono", text: issue.id || "—" }), h("div", { class: "list-item__meta", style: { whiteSpace: "normal" }, text: issue.message || issue.text || "" })),
                h("span", { class: `chip ${issue.level === "error" || issue.severity === "error" ? "chip--mandarin" : "chip--canary"}`, text: issue.level === "error" || issue.severity === "error" ? "error" : "aviso" }))))
              : h("div", { class: "empty small", text: "Sin incidencias." })),
          h("div", { class: "card" },
            h("div", { class: "card__header" }, h("p", { class: "ante-title", style: { marginBottom: 0 }, text: "Últimos cambios" }), h("button", { class: "btn btn--ghost btn--xs", text: "Ver todo", onclick: () => selectTab("activity") })),
            activity.entries.length
              ? h("div", { class: "list" }, activity.entries.slice(0, 5).map((entry) => h("div", { class: "list-item" },
                h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: entry.title }), h("div", { class: "list-item__meta", text: `${entry.actor} · ${fmtDate(entry.at)}` })),
                h("span", { class: "chip chip--outline", text: ACTIVITY_LABELS[entry.kind] || entry.kind }))))
              : h("div", { class: "empty small", text: "Sin actividad registrada todavía." })))),
      h("div", { class: "card", style: { marginTop: "16px" } },
        h("p", { class: "ante-title", text: "Últimos documentos analizados" }),
        documents.documents.length
          ? h("table", { class: "table table--compact" },
            h("thead", {}, h("tr", {}, h("th", { text: "Documento" }), h("th", { text: "Lo incluyó" }), h("th", { text: "Cuándo" }), h("th", { text: "Specs que generó" }))),
            h("tbody", {}, documents.documents.slice(0, 8).map((document) => h("tr", {},
              h("td", {}, h("strong", { text: document.name }), h("div", { class: "small muted", text: fmtBytes(document.size) })),
              h("td", {}, document.importedBy
                ? h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, h("div", { class: "avatar-sm", text: initials(document.importedBy) }), document.importedBy)
                : h("span", { class: "small muted", text: "—" })),
              h("td", { text: document.importedAt ? fmtDate(document.importedAt) : fmtDate(document.modified) }),
              h("td", {}, document.specs?.length
                ? h("div", { class: "chips" }, document.specs.map((id) => h("span", { class: "chip chip--outline mono", style: { cursor: "pointer" }, text: id, onclick: () => selectTab("specs", id) })))
                : h("span", { class: "small muted", text: "—" }))))))
          : h("div", { class: "empty small", text: "Todavía no hay documentos importados." })));

    function statCard(value, label, variant) {
      return h("div", { class: `card ${variant}` }, h("div", { class: "stat" }, h("span", { class: "stat__value", text: String(value ?? 0) }), h("span", { class: "stat__label", text: label })));
    }
    function layerColor(layer) {
      const palette = { architecture: "#001391", domain: "#85C8FF", product: "#88E783", feature: "#FFE761", doc: "#8BE1E9", "work-spec": "#9694FF", "work-plan": "#9694FF", "work-task": "#9694FF", adr: "#FFB56B", rfc: "#FFB56B", rule: "#FFB56B" };
      return palette[layer] || "#46536D";
    }
  }

  /* ---------- Gobernanza: ADR, RFC y reglas ---------- */
  async function renderGovernance(node) {
    const data = await get(`/api/sources/${source.id}/specs`);
    const items = data.specs.filter((spec) => GOVERNANCE_LAYERS.includes(spec.layer));
    const tbody = h("tbody");
    const refresh = async () => {
      const fresh = await get(`/api/sources/${source.id}/specs`);
      clear(tbody);
      paint(fresh.specs.filter((spec) => GOVERNANCE_LAYERS.includes(spec.layer)));
    };
    const paint = (rows) => tbody.append(...(rows.length ? rows.map((spec) => h("tr", {},
      h("td", {}, h("span", { class: "mono", text: spec.id })),
      h("td", {}, layerChip(spec.layer, labelFor(spec.layer))),
      h("td", { text: spec.title }),
      h("td", {}, spec.owner ? h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, h("div", { class: "avatar-sm", text: initials(spec.owner) }), spec.owner) : h("span", { class: "small muted", text: "sin responsable" })),
      h("td", {}, statusChip(spec.status)),
      h("td", { text: spec.updated || "" }),
      h("td", {}, h("div", { class: "card__actions" },
        h("button", { class: "btn btn--outline btn--xs", text: "Abrir", onclick: () => selectTab("specs", spec.id) }),
        ["proposed", "discussion", "draft"].includes(spec.status)
          ? h("button", { class: "btn btn--lime btn--xs", text: "Aceptar", onclick: () => decide(spec, "accepted") })
          : null,
        ["proposed", "discussion", "draft"].includes(spec.status)
          ? h("button", { class: "btn btn--danger btn--xs", text: "Rechazar", onclick: () => decide(spec, "rejected") })
          : null)))) : [h("tr", {}, h("td", { colspan: "7" }, h("div", { class: "empty small", text: "Todavía no hay decisiones ni reglas. Créalas como specs de tipo ADR, RFC o Regla." })))]));
    paint(items);

    node.append(h("div", { class: "bento bento--main-aside" },
      h("div", { class: "card" },
        h("div", { class: "card__header" },
          h("div", {}, h("p", { class: "ante-title", text: "Decisiones y reglas" }), h("h2", { text: "Gobernanza de la base" })),
          h("button", { class: "btn btn--sm", text: "Nueva decisión", onclick: () => selectTab("specs") })),
        h("table", { class: "table table--compact" },
          h("thead", {}, h("tr", {}, h("th", { text: "ID" }), h("th", { text: "Tipo" }), h("th", { text: "Título" }), h("th", { text: "Responsable" }), h("th", { text: "Estado" }), h("th", { text: "Actualizada" }), h("th"))),
          tbody)),
      h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
        h("div", { class: "card card--serene" },
          h("p", { class: "ante-title", text: "Qué vive aquí" }),
          h("p", { class: "small", style: { marginTop: "8px" }, text: "Los ADR recogen decisiones de arquitectura, los RFC propuestas en discusión y las reglas lo que toda spec debe cumplir. Aceptar o rechazar queda firmado en el registro de actividad." })),
        h("div", { class: "card" },
          h("p", { class: "ante-title", text: "Cumplimiento" }),
          h("div", { class: "list", style: { marginTop: "10px" } },
            [["Decisiones aceptadas", items.filter((spec) => spec.status === "accepted").length, items.filter((spec) => spec.layer === "adr").length],
              ["Reglas activas", items.filter((spec) => spec.layer === "rule" && spec.status === "active").length, items.filter((spec) => spec.layer === "rule").length],
              ["Con responsable", items.filter((spec) => spec.owner).length, items.length]]
              .map(([label, ok, total]) => h("div", { class: "list-item" },
                h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: label })),
                h("span", { class: `chip ${total && ok === total ? "chip--lime" : "chip--canary"}`, text: `${ok}/${total}` }))))))));

    async function decide(spec, status) {
      try {
        await post(`/api/sources/${source.id}/specs/${spec.id}/status`, { status });
        toast(`${spec.id} → ${status}`, "ok");
        await refresh();
      } catch (error) {
        toast(error.message, "error");
      }
    }
  }

  /* ---------- Actividad: quién ha cambiado qué ---------- */
  async function renderActivity(node) {
    const filters = { kind: "", actor: "" };
    const listNode = h("div", { class: "timeline" });
    const summaryNode = h("div", { class: "list", style: { marginTop: "10px" } });
    const load = async () => {
      clear(listNode);
      clear(summaryNode);
      const query = new URLSearchParams({ limit: "150", ...(filters.kind ? { kind: filters.kind } : {}), ...(filters.actor ? { actor: filters.actor } : {}) });
      const data = await get(`/api/sources/${source.id}/activity?${query}`);
      if (!data.entries.length) {
        listNode.append(h("div", { class: "empty small", text: "Sin actividad con esos filtros." }));
      } else {
        data.entries.forEach((entry, index) => listNode.append(h("div", { class: "tl" },
          h("div", { class: "tl__rail" }, h("div", { class: `tl__dot is-${entry.kind}` }), index < data.entries.length - 1 ? h("div", { class: "tl__line" }) : null),
          h("div", { class: "tl__body" },
            h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
              h("div", { class: "avatar-sm", text: initials(entry.actor) }),
              h("strong", { text: entry.title }),
              h("span", { class: "chip chip--outline", text: ACTIVITY_LABELS[entry.kind] || entry.kind })),
            entry.detail ? h("div", { class: "tl__meta", style: { marginTop: "4px" }, text: entry.detail }) : null,
            h("div", { class: "tl__meta", text: `${entry.actor} · ${fmtDate(entry.at)}` }),
            entry.specs?.length ? h("div", { class: "chips", style: { marginTop: "6px" } }, entry.specs.map((id) => h("span", { class: "chip chip--outline mono", style: { cursor: "pointer" }, text: id, onclick: () => selectTab("specs", id) }))) : null))));
      }
      for (const actor of data.actors) {
        summaryNode.append(h("div", { class: "list-item" },
          h("div", { class: "list-item__main", style: { flexDirection: "row", alignItems: "center", gap: "10px" } }, h("div", { class: "avatar-sm", text: initials(actor) }), h("span", { class: "list-item__title", text: actor })),
          h("button", { class: "btn btn--ghost btn--xs", text: "Filtrar", onclick: () => { filters.actor = filters.actor === actor ? "" : actor; load(); } })));
      }
      countChip.textContent = `${data.total} eventos`;
    };
    const countChip = h("span", { class: "chip chip--outline", text: "…" });

    node.append(h("div", { class: "bento bento--main-aside" },
      h("div", { class: "card" },
        h("div", { class: "card__header" },
          h("div", {}, h("p", { class: "ante-title", text: "Registro" }), h("h2", { text: "Quién ha cambiado qué" })),
          countChip),
        h("div", { class: "form-row", style: { marginBottom: "16px" } },
          h("select", { class: "select", onchange: (event) => { filters.kind = event.target.value; load(); } },
            h("option", { value: "", text: "Todo tipo de cambio" }),
            ...Object.entries(ACTIVITY_LABELS).map(([value, label]) => h("option", { value, text: label }))),
          h("button", { class: "btn btn--outline btn--sm", text: "Quitar filtros", onclick: () => { filters.kind = ""; filters.actor = ""; load(); } })),
        listNode),
      h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
        h("div", { class: "card card--canary" },
          h("p", { class: "ante-title", text: "Por qué importa" }),
          h("p", { class: "small", style: { marginTop: "8px" }, text: "Cada cambio queda firmado con el usuario de GitHub: quién, cuándo y desde dónde. Las correcciones que hace alguien desde el chat aparecen aquí sobre la spec afectada, para que puedas revisarlas." })),
        h("div", { class: "card" }, h("p", { class: "ante-title", text: "Personas" }), summaryNode))));
    await load();
  }

  /* ---------- Documentos ---------- */
  async function renderDocuments(node) {
    const fileInput = h("input", { type: "file", multiple: true, hidden: true, accept: ".pdf,.docx,.xlsx,.xlsm,.pptx,.md,.markdown,.txt,.csv,.sql,.json,.yaml,.yml,.xml,.html,.htm,.java,.kt,.ts,.js,.py,.go,.cs" });
    const table = h("div");
    const selected = new Set();
    const context = h("textarea", { class: "textarea", placeholder: "Contexto opcional para el análisis: qué es el documento, qué ignorar, qué ya está implementado…", rows: 3 });
    const analyzeButton = h("button", { class: "btn btn--lime", text: "Analizar seleccionados", disabled: true });
    const upload = async (files) => {
      const payload = [];
      for (const file of files) payload.push({ name: file.name, base64: await readFileAsBase64(file) });
      try {
        const result = await post(`/api/sources/${source.id}/documents`, { files: payload });
        toast(`${result.documents.length} documento(s) importado(s)`, "ok");
        await refreshTable();
        loadOverview();
      } catch (error) {
        toast(error.message, "error");
      }
    };
    fileInput.addEventListener("change", () => { upload([...fileInput.files]); fileInput.value = ""; });
    const dropZone = h("div", { class: "empty", text: "Arrastra aquí documentos (PDF, Word, Excel, PowerPoint, Markdown, texto, código) o pulsa Importar.",
      ondragover: (event) => { event.preventDefault(); dropZone.style.borderColor = "#001391"; },
      ondragleave: () => { dropZone.style.borderColor = ""; },
      ondrop: (event) => { event.preventDefault(); dropZone.style.borderColor = ""; upload([...event.dataTransfer.files]); } });
    async function refreshTable() {
      const data = await get(`/api/sources/${source.id}/documents`);
      clear(table);
      if (!data.documents.length) {
        table.append(dropZone);
        return;
      }
      table.append(h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}), h("th", { text: "Documento" }), h("th", { text: "Tamaño" }), h("th", { text: "Importado" }), h("th", {}))),
        h("tbody", {}, data.documents.map((document) => h("tr", {},
          h("td", {}, h("input", { type: "checkbox", disabled: !document.supported, onchange: (event) => { if (event.target.checked) selected.add(document.name); else selected.delete(document.name); analyzeButton.disabled = !selected.size; } })),
          h("td", {}, h("strong", { text: document.name }), document.supported ? null : h("span", { class: "chip chip--mandarin", style: { marginLeft: "8px" }, text: "no soportado" })),
          h("td", { text: fmtBytes(document.size) }),
          h("td", { text: fmtDate(document.modified) }),
          h("td", {}, h("div", { class: "card__actions" },
            h("button", { class: "btn btn--outline btn--xs", text: "Texto", onclick: async () => { const text = await get(`/api/sources/${source.id}/documents/${encodeURIComponent(document.name)}/text`); const { close } = openModal([], { wide: true }); document.querySelector(".modal").append(modalHeader(document.name, close, "Texto extraído"), h("pre", { class: "code", text: text.text })); } }),
            h("a", { class: "btn btn--outline btn--xs", href: `/api/sources/${source.id}/documents/${encodeURIComponent(document.name)}/download`, text: "Descargar" }),
            h("button", { class: "btn btn--danger btn--xs", text: "Borrar", onclick: async () => { if (await confirmDialog("Borrar documento", `Se borra ${document.name} de la base de conocimiento.`, { okLabel: "Borrar", danger: true })) { await del(`/api/sources/${source.id}/documents/${encodeURIComponent(document.name)}`); selected.delete(document.name); refreshTable(); loadOverview(); } } }))))))));
    }
    analyzeButton.addEventListener("click", async () => {
      try {
        const job = await post(`/api/sources/${source.id}/analyze`, { documents: [...selected], userContext: context.value, model: appState.model === "auto" ? "" : appState.model });
        toast("Análisis iniciado", "ok");
        selectTab("analyses", job.id);
      } catch (error) {
        toast(error.message, "error");
      }
    });
    node.append(h("div", { class: "bento bento--main-aside" },
      h("div", { class: "card" }, h("div", { class: "card__header" }, h("div", {}, h("p", { class: "ante-title", text: "Documentos importados" }), h("h2", { text: "Fuentes de conocimiento" })), h("button", { class: "btn", text: "Importar", onclick: () => fileInput.click() })), table, fileInput),
      h("div", { class: "card card--serene" }, h("p", { class: "ante-title", text: "Generar specs" }), h("h3", { text: "Analizar documentos" }), h("p", { class: "small", style: { margin: "8px 0 12px" }, text: "El analizador extrae átomos de conocimiento, los clasifica con la metodología KDD y propone specs. Nada se guarda hasta que confirmes el preview." }), context, h("div", { style: { marginTop: "12px" } }, analyzeButton))));
    await refreshTable();
  }

  /* ---------- Análisis ---------- */
  async function renderAnalyses(node, openJobId) {
    const listNode = h("div", { class: "list" });
    const detailNode = h("div");
    let unsubscribe = null;
    node.append(h("div", { class: "bento bento--aside-main" }, h("div", { class: "card" }, h("p", { class: "ante-title", text: "Análisis" }), listNode), detailNode));
    async function refreshList() {
      const data = await get(`/api/sources/${source.id}/analyses`);
      clear(listNode);
      if (!data.analyses.length) listNode.append(h("div", { class: "empty small", text: "Todavía no hay análisis. Importa documentos y pulsa Analizar." }));
      for (const job of data.analyses) {
        listNode.append(h("div", { class: `list-item is-clickable${job.id === openJobId ? " is-active" : ""}`, onclick: () => openJob(job.id) },
          h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: job.documents.join(", ") }), h("div", { class: "list-item__meta", text: `${fmtDate(job.createdAt)} · ${job.specCount} specs` })),
          statusChip(job.status)));
      }
    }
    async function openJob(jobId) {
      openJobId = jobId;
      unsubscribe?.();
      refreshList();
      clear(detailNode);
      let job = await get(`/api/analyses/${jobId}`);
      const render = () => renderJob(detailNode, job, { refresh: async () => { job = await get(`/api/analyses/${jobId}`); render(); refreshList(); }, onClose: () => { unsubscribe?.(); clear(detailNode); openJobId = ""; refreshList(); } });
      render();
      unsubscribe = subscribe(`analysis:${jobId}`, async (event) => {
        if (["log", "progress", "model"].includes(event.type)) {
          const log = detailNode.querySelector(".log");
          if (log && event.type === "log") { log.append(h("div", { class: "log__line" }, h("span", { class: "log__time", text: new Date(event.at).toLocaleTimeString("es-ES") }), event.data.message)); log.scrollTop = log.scrollHeight; }
          if (event.type === "progress") { const bar = detailNode.querySelector(".progress__bar"); const label = detailNode.querySelector("[data-progress]"); if (bar && event.data.progress?.total) { bar.classList.remove("is-busy"); bar.style.width = `${Math.round((event.data.progress.current / event.data.progress.total) * 100)}%`; } if (label && event.data.progress) label.textContent = `${event.data.progress.message} · ${event.data.progress.current}/${event.data.progress.total}`; }
        } else {
          job = await get(`/api/analyses/${jobId}`);
          render();
          refreshList();
          if (event.type === "done") toast("Preview listo", "ok");
          if (event.type === "failed") toast(`Análisis fallido: ${event.data.error}`, "error", 8000);
        }
      });
    }
    await refreshList();
    if (openJobId) await openJob(openJobId);
    return () => unsubscribe?.();
  }

  function renderJob(node, job, { refresh, onClose }) {
    clear(node);
    const header = h("div", { class: "card__header" },
      h("div", {}, h("p", { class: "ante-title", text: `Análisis · ${fmtDate(job.createdAt)}` }), h("h2", { text: job.documents.join(", ") }), h("div", { class: "chips", style: { marginTop: "8px" } }, statusChip(job.status), h("span", { class: "chip chip--outline", text: job.phase }), job.usage ? h("span", { class: "chip chip--outline", text: `${job.usage.premiumRequests.toFixed(2)} premium req.` }) : null)),
      h("div", { class: "card__actions" },
        job.status === "running" ? h("button", { class: "btn btn--danger btn--sm", text: "Cancelar", onclick: () => post(`/api/analyses/${job.id}/cancel`) }) : null,
        h("button", { class: "btn btn--ghost btn--sm", text: "Cerrar", onclick: onClose })));
    const card = h("div", { class: "card" }, header);
    node.append(card);
    if (job.status === "running") {
      const progress = job.progress || {};
      card.append(
        h("p", { class: "muted small", dataset: { progress: "" }, text: `${progress.message || "Preparando"}${progress.total ? ` · ${progress.current}/${progress.total}` : ""}` }),
        h("div", { class: "progress", style: { margin: "8px 0 12px" } }, h("div", { class: `progress__bar${progress.total ? "" : " is-busy"}`, style: { width: progress.total ? `${Math.round((progress.current / progress.total) * 100)}%` : "0%" } })),
        h("div", { class: "log" }, (job.log || []).map((entry) => h("div", { class: "log__line" }, h("span", { class: "log__time", text: new Date(entry.at).toLocaleTimeString("es-ES") }), entry.message))));
      return;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      card.append(h("div", { class: "callout callout--error", text: job.error || "El análisis no terminó." }), h("div", { class: "log", style: { marginTop: "12px" } }, (job.log || []).map((entry) => h("div", { class: "log__line", text: entry.message }))));
      return;
    }
    if (job.status === "confirmed") {
      card.append(h("div", { class: "callout callout--ok", text: "Análisis confirmado. Specs persistidas:" }), h("table", { class: "table table--compact", style: { marginTop: "12px" } }, h("tbody", {}, (job.results || []).map((result) => h("tr", {}, h("td", { class: "mono", text: result.id }), h("td", {}, statusChip(result.action)), h("td", { class: "small", text: result.error || result.version || "" }))))));
      return;
    }
    if (job.status === "discarded") {
      card.append(h("div", { class: "callout callout--warn", text: "Análisis descartado." }));
      return;
    }
    const preview = job.preview;
    if (!preview) return;
    card.append(h("p", { class: "lead", text: preview.summary || "" }));
    const coverage = preview.coverage || {};
    card.append(h("div", { class: "chips", style: { margin: "12px 0" } },
      h("span", { class: "chip chip--serene", text: `${coverage.totalAtoms || 0} átomos` }),
      h("span", { class: "chip chip--lime", text: `${preview.specs.length} specs propuestas` }),
      h("span", { class: "chip chip--outline", text: `${preview.discarded?.length || 0} descartados` }),
      coverage.unassigned?.length ? h("span", { class: "chip chip--mandarin", text: `${coverage.unassigned.length} átomos sin asignar` }) : null,
      h("span", { class: "chip chip--canary", text: `${preview.openQuestions.filter((item) => !item.resolved).length} preguntas` }),
      h("span", { class: "chip chip--mandarin", text: `${preview.conflicts.filter((item) => !item.resolved).length} conflictos` })));
    if (preview.warnings?.length) card.append(h("details", {}, h("summary", { class: "small muted", text: `${preview.warnings.length} avisos del analizador` }), h("ul", { class: "small" }, preview.warnings.map((warning) => h("li", { text: warning })))));

    // Specs propuestas
    const specsTable = h("table", { class: "table table--compact" },
      h("thead", {}, h("tr", {}, h("th", {}), h("th", { text: "Spec" }), h("th", { text: "Acción" }), h("th", { text: "Capa" }), h("th", { text: "Incidencias" }), h("th", {}))),
      h("tbody", {}, preview.specs.map((spec) => h("tr", {},
        h("td", {}, h("input", { type: "checkbox", checked: spec.selected !== false && spec.action !== "skip", disabled: spec.action === "skip", onchange: async (event) => { await put(`/api/analyses/${job.id}/specs/${spec.id}`, { selected: event.target.checked }); spec.selected = event.target.checked; } })),
        h("td", {}, h("div", { class: "mono", text: spec.id }), h("div", { class: "small", text: spec.title })),
        h("td", {}, h("span", { class: `chip ${spec.action === "create" ? "chip--lime" : spec.action === "enrich" ? "chip--serene" : "chip--outline"}`, text: spec.action === "create" ? "nueva" : spec.action === "enrich" ? "enriquecer" : "omitir" }), spec.existing?.protected ? h("div", { class: "small muted", text: "spec validada: solo evidencia" }) : null),
        h("td", {}, layerChip(spec.layer, labelFor(spec.layer))),
        h("td", {}, spec.blocking ? h("span", { class: "chip chip--mandarin", text: `${spec.issues.filter((issue) => issue.severity === "error").length} bloqueantes` }) : spec.issues?.length ? h("span", { class: "chip chip--canary", text: `${spec.issues.length} avisos` }) : h("span", { class: "chip chip--lime", text: "ok" })),
        h("td", {}, h("button", { class: "btn btn--outline btn--xs", text: "Revisar", onclick: () => openPreviewSpec(job, spec, refresh) }))))));
    card.append(h("h3", { style: { margin: "16px 0 8px" }, text: "Specs propuestas" }), preview.specs.length ? specsTable : h("div", { class: "empty small", text: "El analizador no propuso specs." }));

    // Preguntas y conflictos
    const questions = [...preview.openQuestions, ...preview.conflicts];
    if (questions.length) {
      card.append(h("h3", { style: { margin: "16px 0 8px" }, text: "Preguntas abiertas y conflictos" }), h("div", { class: "list" }, questions.map((item) => {
        const input = h("input", { class: "input", placeholder: "Resolución (opcional)", value: item.resolution || "" });
        return h("div", { class: `list-item${item.resolved ? " is-active" : ""}`, style: { alignItems: "flex-start", flexDirection: "column" } },
          h("div", { class: "chips" }, h("span", { class: `chip ${item.kind === "conflict" ? "chip--mandarin" : "chip--canary"}`, text: item.kind === "conflict" ? "conflicto" : "pregunta" }), h("span", { class: "chip chip--outline", text: item.id }), item.resolved ? h("span", { class: "chip chip--lime", text: "resuelta" }) : null),
          h("p", { text: item.text }),
          h("div", { class: "form-row", style: { width: "100%" } }, input, h("button", { class: "btn btn--outline btn--sm", text: item.resolved ? "Reabrir" : "Marcar resuelta", onclick: async () => { await post(`/api/analyses/${job.id}/questions/${item.id}`, { resolution: input.value, resolved: !item.resolved }); refresh(); } })));
      })));
    }
    if (preview.discarded?.length) card.append(h("details", { style: { marginTop: "12px" } }, h("summary", { class: "small muted", text: "Átomos descartados" }), h("ul", { class: "small" }, preview.discarded.map((item) => h("li", { text: `${item.atomId}: ${item.summary} — ${item.reason}` })))));

    // Chat de resolución
    const chatHost = h("div", { class: "card", style: { marginTop: "16px" } }, h("p", { class: "ante-title", text: "Chat de resolución" }), h("p", { class: "small muted", style: { marginBottom: "8px" }, text: "Resuelve las preguntas y ajusta las specs propuestas antes de persistir. Las acciones del asistente se aplican al preview." }));
    const chatButton = h("button", { class: "btn btn--outline btn--sm", text: "Abrir chat de resolución", onclick: async () => {
      chatButton.disabled = true;
      let chat = (await get(`/api/chats?kind=resolution`)).chats.find((item) => item.jobId === job.id);
      if (!chat) chat = await post("/api/chats", { kind: "resolution", jobId: job.id, sourceIds: [source.id], title: `Resolución · ${job.documents.join(", ")}`.slice(0, 80) });
      const view = createChatView({ chatId: chat.id, placeholder: "Pregunta o pide cambios sobre las specs del preview…", onMessage: (message) => { if (message.applied?.length) refresh(); } });
      chatHost.append(view.root);
      await view.load();
    } });
    chatHost.append(chatButton);
    node.append(chatHost);

    node.append(h("div", { class: "card__actions", style: { marginTop: "16px" } },
      h("button", { class: "btn btn--lime", text: "Confirmar y persistir", onclick: async () => {
        const blocking = preview.specs.filter((spec) => spec.selected !== false && spec.action !== "skip" && spec.blocking);
        if (blocking.length && !(await confirmDialog("Specs con incidencias", `${blocking.length} spec(s) tienen incidencias bloqueantes. ¿Persistirlas de todos modos?`, { okLabel: "Persistir igualmente" }))) return;
        try {
          const result = await post(`/api/analyses/${job.id}/confirm`);
          toast(`Persistidas ${result.results.filter((item) => item.action !== "error").length} specs`, "ok");
          refresh();
          loadOverview();
          refreshSources();
        } catch (error) {
          toast(error.message, "error");
        }
      } }),
      h("button", { class: "btn btn--outline", text: "Descartar análisis", onclick: async () => { if (await confirmDialog("Descartar", "Se descarta el preview; no se guarda ninguna spec.", { okLabel: "Descartar", danger: true })) { await post(`/api/analyses/${job.id}/discard`); refresh(); } } })));
  }

  function openPreviewSpec(job, spec, refresh) {
    const { close } = openModal([], { wide: true });
    const title = h("input", { class: "input", value: spec.title });
    const bodyInput = h("textarea", { class: "textarea textarea--code", text: spec.body });
    const idInput = h("input", { class: "input mono", value: spec.id, disabled: spec.action !== "create" });
    document.querySelector(".modal").append(
      modalHeader(spec.id, close, `${spec.action === "create" ? "Spec nueva" : "Enriquecimiento"} · ${labelFor(spec.layer)}`),
      spec.reasoning ? h("div", { class: "callout callout--info small", text: spec.reasoning }) : null,
      (spec.issues || []).length ? h("div", { class: "list" }, spec.issues.map((issue) => h("div", { class: `callout small ${issue.severity === "error" ? "callout--error" : "callout--warn"}`, text: issue.message }))) : null,
      h("div", { class: "bento bento--2" }, h("div", { class: "field" }, h("label", { text: "Identificador" }), idInput), h("div", { class: "field" }, h("label", { text: "Título" }), title)),
      h("dl", { class: "kv" }, h("dt", { text: "Dependencias" }), h("dd", { text: spec.dependencies.map((dep) => `${dep.id} (${dep.type})`).join(", ") || "ninguna" }), h("dt", { text: "Átomos" }), h("dd", { text: spec.atomIds?.join(", ") || "—" }), h("dt", { text: "Tags" }), h("dd", { text: spec.tags?.join(", ") || "—" })),
      h("div", { class: "field" }, h("label", { text: "Cuerpo (Markdown)" }), bodyInput),
      h("div", { class: "card__actions", style: { justifyContent: "flex-end" } }, h("button", { class: "btn", text: "Guardar en el preview", onclick: async () => { try { await put(`/api/analyses/${job.id}/specs/${spec.id}`, { title: title.value, body: bodyInput.value, id: idInput.value }); close(); refresh(); } catch (error) { toast(error.message, "error"); } } })),
      h("div", { class: "card card--sand" }, h("p", { class: "ante-title", text: "Vista previa" }), md(spec.body)),
    );
  }

  /* ---------- Specs ---------- */
  async function renderSpecs(node, openId) {
    const filters = { layer: "", status: "", q: "" };
    const tableNode = h("div");
    const detailNode = h("div");
    const search = h("input", { class: "input", placeholder: "Buscar por texto…", oninput: (event) => { filters.q = event.target.value; refreshTable(); } });
    const layerSelect = h("select", { class: "select", onchange: (event) => { filters.layer = event.target.value; refreshTable(); } }, h("option", { value: "", text: "Todas las capas" }), layers.map((layer) => h("option", { value: layer.id, text: layer.label })));
    const statusSelect = h("select", { class: "select", onchange: (event) => { filters.status = event.target.value; refreshTable(); } }, h("option", { value: "", text: "Cualquier estado" }), ["draft", "active", "deprecated", "completed", "archived", "proposed", "accepted"].map((status) => h("option", { value: status, text: status })));
    node.append(h("div", { class: "bento bento--aside-main" },
      h("div", { class: "card" },
        h("div", { class: "card__header" }, h("div", {}, h("p", { class: "ante-title", text: "Catálogo" }), h("h2", { text: "Specs" })), h("button", { class: "btn btn--sm", text: "Nueva spec", onclick: () => newSpecDialog() })),
        h("div", { class: "list", style: { marginBottom: "12px" } }, search, h("div", { class: "form-row" }, layerSelect, statusSelect)),
        tableNode),
      detailNode));
    async function refreshTable() {
      let specs;
      if (filters.q.trim()) {
        const data = await get(`/api/sources/${source.id}/search?q=${encodeURIComponent(filters.q)}&limit=50`);
        specs = data.results;
      } else {
        specs = (await get(`/api/sources/${source.id}/specs`)).specs;
      }
      specs = specs.filter((spec) => (!filters.layer || spec.layer === filters.layer) && (!filters.status || spec.status === filters.status));
      clear(tableNode);
      if (!specs.length) { tableNode.append(h("div", { class: "empty small", text: "No hay specs con esos filtros." })); return; }
      tableNode.append(h("div", { class: "list" }, specs.map((spec) => h("div", { class: `list-item is-clickable${spec.id === openId ? " is-active" : ""}`, onclick: () => openSpec(spec.id) },
        h("div", { class: "list-item__main" }, h("div", { class: "list-item__title" }, h("span", { class: "mono", text: spec.id }), " ", spec.title), h("div", { class: "list-item__meta", text: spec.summary || spec.snippet || "" })),
        h("div", { class: "chips" }, layerChip(spec.layer, labelFor(spec.layer)), statusChip(spec.status))))));
    }
    async function openSpec(id) {
      openId = id;
      refreshTable();
      clear(detailNode);
      try {
        const data = await get(`/api/sources/${source.id}/specs/${encodeURIComponent(id)}`);
        detailNode.append(renderSpecDetail(data, { onChanged: () => { refreshTable(); openSpec(id); loadOverview(); }, onRemoved: () => { openId = ""; clear(detailNode); refreshTable(); loadOverview(); } }));
      } catch (error) {
        detailNode.append(h("div", { class: "callout callout--error", text: error.message }));
      }
    }
    async function newSpecDialog() {
      const { close } = openModal([], {});
      const layerInput = h("select", { class: "select" }, layers.map((layer) => h("option", { value: layer.id, text: `${layer.label} (${layer.prefix})` })));
      const domain = h("input", { class: "input", placeholder: "Segmento opcional, p. ej. RISK" });
      const title = h("input", { class: "input", placeholder: "Título" });
      document.querySelector(".modal").append(
        modalHeader("Nueva spec", close, "Creación manual"),
        h("p", { class: "muted small", text: "Doriath asigna el identificador siguiendo el patrón de la caja y crea el cuerpo con las secciones canónicas de la capa. Para crear specs con ayuda del asistente usa la pestaña Crear specs." }),
        h("div", { class: "bento bento--2" }, h("div", { class: "field" }, h("label", { text: "Capa" }), layerInput), h("div", { class: "field" }, h("label", { text: "Dominio" }), domain)),
        h("div", { class: "field" }, h("label", { text: "Título" }), title),
        h("div", { class: "card__actions", style: { justifyContent: "flex-end" } }, h("button", { class: "btn", text: "Crear", onclick: async () => { try { const result = await post(`/api/sources/${source.id}/specs`, { layer: layerInput.value, domain: domain.value, title: title.value }); close(); toast(`Creada ${result.spec.id}`, "ok"); refreshTable(); openSpec(result.spec.id); loadOverview(); } catch (error) { toast(error.message, "error"); } } })));
    }
    await refreshTable();
    if (openId) openSpec(openId);
  }

  function renderSpecDetail({ spec, issues, impact, markdown }, { onChanged, onRemoved }) {
    const card = h("div", { class: "card" });
    let editing = false;
    const render = () => {
      clear(card);
      card.append(h("div", { class: "card__header" },
        h("div", {}, h("p", { class: "ante-title", text: `${labelFor(spec.layer)} · versión ${spec.version}` }), h("h2", {}, h("span", { class: "mono", text: spec.id })), h("h3", { style: { marginTop: "4px", fontFamily: "var(--bbva-font-body)", color: "var(--bbva-midnight)" }, text: spec.title })),
        h("div", { class: "card__actions" },
          h("button", { class: "btn btn--outline btn--sm", text: editing ? "Cancelar" : "Editar", onclick: () => { editing = !editing; render(); } }),
          spec.status !== "deprecated" ? h("button", { class: "btn btn--outline btn--sm", text: "Deprecar", onclick: async () => { if (await confirmDialog("Deprecar spec", "La spec se conserva con sus relaciones, pero deja de considerarse vigente.", { okLabel: "Deprecar" })) { await post(`/api/sources/${source.id}/specs/${spec.id}/status`, { status: "deprecated" }); onChanged(); } } }) : h("button", { class: "btn btn--outline btn--sm", text: "Reactivar", onclick: async () => { await post(`/api/sources/${source.id}/specs/${spec.id}/status`, { status: "active" }); onChanged(); } }),
          h("button", { class: "btn btn--danger btn--sm", text: "Borrar", onclick: async () => { if (await confirmDialog("Borrar spec", "Borrar es irreversible. Deprecar suele ser la opción correcta.", { okLabel: "Borrar definitivamente", danger: true })) { await del(`/api/sources/${source.id}/specs/${spec.id}`); onRemoved(); } } }))),
      h("div", { class: "chips", style: { margin: "8px 0 12px" } }, statusChip(spec.status), confidenceChip(spec.confidence), spec.owner ? h("span", { class: "chip chip--outline", text: spec.owner }) : null, ...(spec.tags || []).map((tag) => h("span", { class: "chip chip--ice", text: tag }))));
      if (issues?.length) card.append(h("div", { class: "list", style: { marginBottom: "12px" } }, issues.map((issue) => h("div", { class: `callout small ${issue.severity === "error" ? "callout--error" : "callout--warn"}`, text: issue.message }))));
      if (editing) {
        const title = h("input", { class: "input", value: spec.title });
        const status = h("select", { class: "select" }, ["draft", "active", "deprecated", "completed", "archived", "proposed", "accepted", "rejected", "discussion"].map((value) => h("option", { value, text: value, selected: spec.status === value })));
        const confidence = h("select", { class: "select" }, ["low", "medium", "high"].map((value) => h("option", { value, text: value, selected: spec.confidence === value })));
        const owner = h("input", { class: "input", value: spec.owner || "" });
        const tags = h("input", { class: "input", value: (spec.tags || []).join(", ") });
        const body = h("textarea", { class: "textarea textarea--code", text: spec.body });
        card.append(
          h("div", { class: "bento bento--2" }, h("div", { class: "field" }, h("label", { text: "Título" }), title), h("div", { class: "field" }, h("label", { text: "Propietario" }), owner), h("div", { class: "field" }, h("label", { text: "Estado" }), status), h("div", { class: "field" }, h("label", { text: "Confianza" }), confidence), h("div", { class: "field" }, h("label", { text: "Tags (separados por comas)" }), tags)),
          h("div", { class: "field", style: { marginTop: "12px" } }, h("label", { text: "Cuerpo (Markdown)" }), body),
          h("div", { class: "card__actions", style: { marginTop: "12px", justifyContent: "flex-end" } }, h("button", { class: "btn", text: "Guardar", onclick: async () => { try { await put(`/api/sources/${source.id}/specs/${spec.id}`, { title: title.value, status: status.value, confidence: confidence.value, owner: owner.value, tags: tags.value.split(",").map((tag) => tag.trim()).filter(Boolean), body: body.value }); toast("Spec guardada", "ok"); editing = false; onChanged(); } catch (error) { toast(error.message, "error"); } } })));
        return;
      }
      card.append(h("dl", { class: "kv", style: { marginBottom: "12px" } },
        h("dt", { text: "Dependencias" }), h("dd", { text: (spec.dependencies || []).map((dep) => `${dep.id} (${dep.type})`).join(", ") || "ninguna" }),
        spec.activates?.length ? h("dt", { text: "Activa" }) : null, spec.activates?.length ? h("dd", { text: spec.activates.join(", ") }) : null,
        spec.parent ? h("dt", { text: "Padre" }) : null, spec.parent ? h("dd", { text: spec.parent }) : null,
        h("dt", { text: "Impacto" }), h("dd", { text: impact?.length ? impact.map((item) => `${item.id} (${item.via})`).join(", ") : "ninguna spec depende de esta" }),
        h("dt", { text: "Fichero" }), h("dd", { class: "mono small", text: spec.filePath })));
      card.append(md(spec.body));
      card.append(h("details", { style: { marginTop: "12px" } }, h("summary", { class: "small muted", text: "Ver Markdown completo" }), h("pre", { class: "code", text: markdown })));
    };
    render();
    return card;
  }

  /* ---------- Grafo ---------- */
  async function renderGraph(node) {
    const data = await get(`/api/sources/${source.id}/graph`);
    const card = h("div", { class: "card" });
    node.append(card);
    card.append(h("div", { class: "card__header" }, h("div", {}, h("p", { class: "ante-title", text: "Grafo de conocimiento" }), h("h2", { text: `${data.stats.specs} specs · ${data.stats.relations} relaciones` })), h("div", { class: "legend" }, [["architecture", "#9694FF"], ["domain", "#85C8FF"], ["product", "#8BE1E9"], ["feature", "#88E783"], ["doc", "#CAD1D8"], ["work", "#FFE761"], ["governance", "#FFB56B"]].map(([layer, color]) => h("span", { style: { "--dot": color }, text: labelFor(layer) || layer })))));
    if (!data.nodes.length) { card.append(h("div", { class: "empty", text: "Todavía no hay specs en esta base de conocimiento." })); return; }
    const colors = { architecture: "#9694FF", domain: "#85C8FF", product: "#8BE1E9", feature: "#88E783", doc: "#CAD1D8", "work-spec": "#FFE761", "work-plan": "#FFE761", "work-task": "#FFE761", adr: "#FFB56B", rfc: "#FFB56B", rule: "#FFB56B" };
    const columnsOrder = ["adr", "rfc", "rule", "architecture", "domain", "product", "feature", "doc", "work-spec", "work-plan", "work-task"];
    const width = 1200; const height = 560;
    const groups = new Map();
    for (const item of data.nodes) { if (!groups.has(item.layer)) groups.set(item.layer, []); groups.get(item.layer).push(item); }
    const activeColumns = columnsOrder.filter((layer) => groups.has(layer));
    const positions = new Map();
    activeColumns.forEach((layer, column) => {
      const items = groups.get(layer);
      items.forEach((item, row) => positions.set(item.id, { x: 80 + column * ((width - 160) / Math.max(1, activeColumns.length - 1 || 1)), y: 50 + (row + 0.5) * ((height - 80) / items.length) }));
    });
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "graph");
    for (const edge of data.edges) {
      const from = positions.get(edge.from); const to = positions.get(edge.to);
      if (!from || !to) continue;
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", from.x); line.setAttribute("y1", from.y); line.setAttribute("x2", to.x); line.setAttribute("y2", to.y);
      if (edge.broken) line.setAttribute("class", "broken");
      const title = document.createElementNS(svgNS, "title"); title.textContent = `${edge.from} —${edge.type}→ ${edge.to}`; line.append(title);
      svg.append(line);
    }
    for (const item of data.nodes) {
      const position = positions.get(item.id);
      const group = document.createElementNS(svgNS, "g");
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", position.x); circle.setAttribute("cy", position.y); circle.setAttribute("r", 9); circle.setAttribute("fill", colors[item.layer] || "#E2E6EA");
      circle.addEventListener("click", () => selectTab("specs", item.id));
      const title = document.createElementNS(svgNS, "title"); title.textContent = `${item.id} — ${item.title}`; circle.append(title);
      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", position.x + 12); label.setAttribute("y", position.y + 4); label.textContent = item.id;
      group.append(circle, label);
      svg.append(group);
    }
    card.append(svg);
    if (data.issues?.length) card.append(h("div", { class: "list", style: { marginTop: "12px" } }, data.issues.map((issue) => h("div", { class: "callout callout--warn small", text: issue.message }))));
    if (data.orphans?.length) card.append(h("p", { class: "small muted", style: { marginTop: "8px" }, text: `Specs sin relaciones: ${data.orphans.join(", ")}` }));
  }

  /* ---------- Crear specs (chat) ---------- */
  async function renderCreate(node) {
    const chatHost = h("div");
    const packageHost = h("div");
    const listNode = h("div", { class: "list" });
    let view = null;
    node.append(h("div", { class: "bento", style: { gridTemplateColumns: "260px minmax(0, 1fr) 360px", alignItems: "start" } },
      h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } }, h("div", { class: "card card--serene" }, h("p", { class: "ante-title", text: "Entrevista KDD" }), h("h3", { text: "Crear specs con el asistente" }), h("p", { class: "small", style: { margin: "8px 0 12px" }, text: "Describe el conocimiento en lenguaje de negocio. El asistente clasifica, valida y propone las specs (conocimiento y gobernanza)." }), h("button", { class: "btn", text: "Nueva sesión", onclick: () => startChat() })), h("div", { class: "card" }, h("p", { class: "ante-title", text: "Sesiones" }), listNode)),
      chatHost,
      packageHost));
    async function refreshList(currentId) {
      const data = await get(`/api/chats?kind=knowledge&sourceId=${source.id}`);
      clear(listNode);
      if (!data.chats.length) listNode.append(h("div", { class: "muted small", text: "Sin sesiones." }));
      for (const chat of data.chats) listNode.append(h("div", { class: `list-item is-clickable${chat.id === currentId ? " is-active" : ""}`, onclick: () => openChat(chat.id) }, h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: chat.title }), h("div", { class: "list-item__meta", text: fmtDate(chat.updatedAt) })), chat.hasPackage ? h("span", { class: "chip chip--canary", text: "paquete" }) : null));
    }
    async function startChat() {
      const chat = await post("/api/chats", { kind: "knowledge", sourceIds: [source.id], model: appState.model === "auto" ? "" : appState.model });
      await openChat(chat.id);
    }
    async function openChat(id) {
      view?.destroy();
      clear(chatHost);
      view = createChatView({ chatId: id, showPhase: true, placeholder: "Describe el conocimiento que quieres formalizar…", onState: (chat) => { view.setPhase(); renderPackage(chat); } });
      chatHost.append(h("div", { class: "card" }, view.root));
      await view.load();
      refreshList(id);
    }
    function renderPackage(chat) {
      clear(packageHost);
      packageHost.append(renderPackagePanel({ chatId: chat.id, pkg: chat.state?.package, layers, onChanged: async () => { await view.refresh(); loadOverview(); refreshSources(); refreshList(chat.id); } }));
    }
    await refreshList();
    packageHost.append(renderPackagePanel({ chatId: "", pkg: null, layers }));
    return () => view?.destroy();
  }

  /* ---------- Pendientes ---------- */
  async function renderPending(node) {
    const data = await get(`/api/sources/${source.id}/pending`);
    const overview = await get(`/api/sources/${source.id}/overview`);
    const card = h("div", { class: "card" }, h("p", { class: "ante-title", text: "Preguntas pendientes" }), h("h2", { text: `${data.pending.length} pendientes de análisis anteriores` }));
    node.append(card);
    if (!data.pending.length) card.append(h("div", { class: "empty small", style: { marginTop: "12px" }, text: "No hay preguntas pendientes." }));
    else card.append(h("div", { class: "list", style: { marginTop: "12px" } }, data.pending.map((item) => h("div", { class: "list-item" }, h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: item.text }), h("div", { class: "list-item__meta", text: `${item.kind} · ${item.document || ""} · ${fmtDate(item.at)}` })), h("button", { class: "btn btn--outline btn--xs", text: "Resuelta", onclick: async () => { await del(`/api/sources/${source.id}/pending/${item.id}`); selectTab("pending"); loadOverview(); } })))));
    if (overview.issues.length || overview.problems.length) {
      node.append(h("div", { class: "card", style: { marginTop: "16px" } }, h("p", { class: "ante-title", text: "Incidencias del grafo y de ficheros" }), h("div", { class: "list" }, [...overview.issues.map((issue) => h("div", { class: "callout callout--warn small", text: issue.message })), ...overview.problems.map((problem) => h("div", { class: "callout callout--error small", text: `${problem.filePath}: ${problem.errors.join("; ")}` }))])));
    }
  }

  await loadOverview();
  renderTabs();
  await selectTab(tab, params[1]);
  return { destroy: () => cleanup?.() };
}
