/** Doriath — aplicación (shell, navegación, bases de conocimiento, sesión). */
import { get, post, put, del } from "./api.js";
import { h, clear, toast, openModal, modalHeader, confirmDialog, promptDialog, pickFolder, fmtDate } from "./ui.js";
import { renderKnowledge } from "./views/knowledge.js";
import { renderAssistant } from "./views/assistant.js";
import { renderWork } from "./views/work.js";

export const state = {
  status: null,
  sources: [],
  activeSourceId: localStorage.getItem("doriath.activeSource") || "",
  models: null,
  model: localStorage.getItem("doriath.model") || "auto",
  route: "knowledge",
  routeParams: {},
  gateOpen: false,
};

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) fn(state);
}

export function activeSource() {
  return state.sources.find((source) => source.id === state.activeSourceId) || null;
}

export async function refreshSources() {
  const data = await get("/api/sources?stats=1");
  state.sources = data.sources;
  state.layers = data.layers;
  if (!state.sources.some((source) => source.id === state.activeSourceId)) {
    state.activeSourceId = state.sources.find((source) => source.exists)?.id || "";
    localStorage.setItem("doriath.activeSource", state.activeSourceId);
  }
  renderSourceMenu();
  notify();
  return state.sources;
}

export function setActiveSource(id) {
  state.activeSourceId = id;
  localStorage.setItem("doriath.activeSource", id);
  post(`/api/sources/${id}/touch`).catch(() => undefined);
  renderSourceMenu();
  notify();
  renderRoute();
}

function renderSourceMenu() {
  const menu = document.getElementById("sourceMenu");
  clear(menu);
  if (!state.sources.length) {
    menu.append(h("div", { class: "source-menu__empty", text: "Sin bases de conocimiento. Pulsa Gestionar para añadir o crear una." }));
    return;
  }
  for (const source of state.sources) {
    const specs = source.stats?.specs ?? 0;
    menu.append(h("div", {
      class: `source-item${source.id === state.activeSourceId ? " is-active" : ""}${source.exists ? "" : " is-missing"}`,
      onclick: () => source.exists && setActiveSource(source.id),
      title: source.path,
    },
    h("span", { class: "source-item__dot" }),
    h("div", { style: { minWidth: 0 } },
      h("div", { class: "source-item__name", text: source.name }),
      h("div", { class: "source-item__meta", text: source.exists ? `${source.sourceId} · ${specs} specs · ${source.stats?.documents ?? 0} docs` : "carpeta no disponible" }))));
  }
}

/* ---------- Gestión de bases de conocimiento ---------- */
export async function openSourcesManager() {
  const { close } = openModal([], {});
  const body = h("div", { class: "list" });
  const render = async () => {
    clear(body);
    if (!state.sources.length) body.append(h("div", { class: "empty", text: "Todavía no hay bases de conocimiento registradas." }));
    for (const source of state.sources) {
      body.append(h("div", { class: "list-item" },
        h("div", { class: "list-item__main" },
          h("div", { class: "list-item__title", text: `${source.name} · ${source.sourceId}` }),
          h("div", { class: "list-item__meta mono", text: source.path }),
          h("div", { class: "list-item__meta", text: source.exists ? `${source.stats?.specs ?? 0} specs · ${source.stats?.documents ?? 0} documentos · ${source.stats?.relations ?? 0} relaciones` : "La carpeta no existe en este equipo" })),
        h("div", { class: "card__actions" },
          h("button", { class: "btn btn--outline btn--sm", text: "Renombrar", onclick: async () => { const name = await promptDialog("Renombrar base de conocimiento", { label: "Nombre", value: source.name }); if (name) { await put(`/api/sources/${source.id}`, { name }); await refreshSources(); render(); } } }),
          h("button", { class: "btn btn--outline btn--sm", text: "Abrir carpeta", onclick: () => post("/api/open", { path: source.path }).catch((error) => toast(error.message, "error")) }),
          h("button", { class: "btn btn--danger btn--sm", text: "Quitar", onclick: async () => { if (await confirmDialog("Quitar del registro", `Se quitará "${source.name}" de Doriath. La carpeta y sus specs no se borran.`, { okLabel: "Quitar", danger: true })) { await del(`/api/sources/${source.id}`); await refreshSources(); render(); } } }))));
    }
  };
  const addExisting = async () => {
    const folder = await pickFolder({ title: "Selecciona la carpeta de la base de conocimiento" });
    if (!folder) return;
    try {
      const result = await post("/api/sources/add", { path: folder });
      toast(result.created ? `Base de conocimiento añadida: ${result.source.name}` : "Esa carpeta ya estaba registrada.", "ok");
      await refreshSources();
      if (result.created) setActiveSource(result.source.id);
      render();
    } catch (error) {
      toast(error.message, "error");
    }
  };
  const createNew = async () => {
    const name = await promptDialog("Nueva base de conocimiento", { label: "Nombre", placeholder: "p. ej. Global Markets · Riesgo de mercado" });
    if (!name) return;
    const parent = await pickFolder({ title: "Carpeta donde crear la base de conocimiento (Cancelar = carpeta por defecto)" });
    try {
      const source = await post("/api/sources/create", { name, parentDir: parent || undefined });
      toast(`Creada ${source.name} (${source.sourceId}) en ${source.path}`, "ok");
      await refreshSources();
      setActiveSource(source.id);
      render();
    } catch (error) {
      toast(error.message, "error");
    }
  };
  document.querySelector(".modal").append(
    modalHeader("Bases de conocimiento", close, "Cajas KDD locales"),
    h("p", { class: "muted", text: "Cada base de conocimiento es una carpeta local con specs KDD (compatible con KDD Studio). Puedes añadir una carpeta existente o crear una nueva." }),
    h("div", { class: "card__actions" },
      h("button", { class: "btn", text: "Añadir carpeta existente", onclick: addExisting }),
      h("button", { class: "btn btn--accent", text: "Crear nueva", onclick: createNew }),
      h("button", { class: "btn btn--outline", text: "Escribir ruta a mano", onclick: async () => { const value = await promptDialog("Ruta de la carpeta", { label: "Ruta", placeholder: "C:\\\\Proyectos\\\\kb-riesgos" }); if (value) { try { const result = await post("/api/sources/add", { path: value }); await refreshSources(); if (result.created) setActiveSource(result.source.id); render(); } catch (error) { toast(error.message, "error"); } } } })),
    body,
  );
  render();
}

/* ---------- Sesión y estado ---------- */
export async function refreshStatus({ copilot = true } = {}) {
  state.status = await get(`/api/status?copilot=${copilot ? "1" : "0"}`);
  renderSession();
  renderGate();
  return state.status;
}

function renderSession() {
  const badge = document.getElementById("sessionBadge");
  clear(badge);
  const github = state.status?.github;
  if (!github) return;
  if (!github.installed) {
    badge.append(h("div", { class: "session__avatar", text: "!" }), h("div", {}, h("div", { class: "session__name", text: "GitHub CLI no encontrada" }), h("div", { class: "session__state", text: "Instala gh para continuar" })));
    return;
  }
  if (!github.authenticated) {
    badge.append(h("div", { class: "session__avatar", text: "?" }), h("div", {}, h("div", { class: "session__name", text: "Sin sesión" }), h("button", { class: "btn btn--accent btn--xs", text: "Iniciar sesión", onclick: startLogin })));
    return;
  }
  const name = github.user?.name || github.user?.login || github.login || "usuario";
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  badge.append(
    h("div", { class: "session__avatar" }, github.user?.avatarUrl ? h("img", { src: github.user.avatarUrl, alt: "" }) : initials),
    h("div", {}, h("div", { class: "session__name", text: name }), h("div", { class: "session__state", text: `${github.host} · ${state.status.copilot?.available ? `Copilot listo (${state.status.copilot.models} modelos)` : "Copilot no disponible"}` })),
  );
}

async function startLogin() {
  try {
    const result = await post("/api/auth/login");
    toast(result.message, result.started ? "info" : "error", 8000);
    pollAuth();
  } catch (error) {
    toast(error.message, "error");
  }
}

let authPoll = null;
function pollAuth() {
  clearInterval(authPoll);
  let attempts = 0;
  authPoll = setInterval(async () => {
    attempts += 1;
    const auth = await get("/api/auth/status?refresh=1").catch(() => null);
    if (auth?.authenticated || attempts > 90) {
      clearInterval(authPoll);
      if (auth?.authenticated) {
        toast(`Sesión iniciada como ${auth.user?.name || auth.login}`, "ok");
        await post("/api/auth/refresh").catch(() => undefined);
        await refreshStatus();
        await loadModels();
      }
    }
  }, 4000);
}

function renderGate() {
  const github = state.status?.github;
  const needsGate = github && (!github.installed || !github.authenticated);
  const existing = document.getElementById("gate");
  if (!needsGate) {
    if (existing) {
      existing.remove();
      document.getElementById("overlay").hidden = true;
      state.gateOpen = false;
    }
    return;
  }
  if (existing) return;
  state.gateOpen = true;
  const overlay = document.getElementById("overlay");
  overlay.hidden = false;
  overlay.onclick = null;
  overlay.replaceChildren(h("div", { class: "gate", id: "gate" },
    h("img", { src: "/brand/doriath-mark-white.png", alt: "", class: "gate__mark" }),
    h("div", {}, h("p", { class: "ante-title", text: "Doriath · BBVA CIB" }), h("h1", { text: github.installed ? "Inicia sesión en GitHub" : "Falta GitHub CLI" })),
    h("p", { class: "lead", text: github.installed
      ? `Doriath usa tu sesión corporativa de GitHub (${github.host}) para acceder a los repositorios y a GitHub Copilot. Al pulsar el botón se abrirá una consola y el navegador para completar el inicio de sesión con tu correo de BBVA.`
      : "No se ha encontrado la CLI de GitHub (gh). Instálala o vuelve a ejecutar el instalador de Doriath, y después pulsa Reintentar." }),
    h("div", { class: "card__actions" },
      github.installed ? h("button", { class: "btn btn--accent", text: "Iniciar sesión en GitHub", onclick: startLogin }) : null,
      h("button", { class: "btn btn--outline", style: { color: "#F7F8F8", borderColor: "#85C8FF" }, text: "Reintentar", onclick: () => refreshStatus() }),
      h("button", { class: "btn btn--ghost", style: { color: "#85C8FF" }, text: "Continuar sin sesión", onclick: () => { existing?.remove(); document.getElementById("gate")?.remove(); overlay.hidden = true; state.gateOpen = false; } })),
    h("p", { class: "small", style: { opacity: 0.8 }, text: `También puedes ejecutarlo a mano: gh auth login --hostname ${github.host} --web --git-protocol https` }),
  ));
}

/* ---------- Modelos ---------- */
export async function loadModels({ refresh = false } = {}) {
  const picker = document.getElementById("modelPicker");
  try {
    state.models = await get(`/api/models${refresh ? "?refresh=1" : ""}`);
  } catch (error) {
    state.models = null;
    picker.replaceChildren(h("span", { class: "chip chip--outline", title: error.message, text: "Copilot no disponible" }));
    return;
  }
  const select = h("select", { onchange: (event) => { state.model = event.target.value; localStorage.setItem("doriath.model", state.model); notify(); } },
    h("option", { value: "auto", text: "Modelo automático" }),
    ...state.models.models.map((model) => h("option", { value: model.id, text: `${model.name}${model.multiplier ? ` (x${model.multiplier})` : ""}`, selected: model.id === state.model })));
  if (!state.models.models.some((model) => model.id === state.model)) state.model = "auto";
  const quota = state.models.quota;
  picker.replaceChildren(select, quota && !quota.unlimited ? h("span", { class: "chip chip--outline", title: "Cuota premium restante", text: `${quota.remaining}/${quota.entitlement}` }) : null);
}

/* ---------- Ajustes ---------- */
async function openSettings() {
  const config = await get("/api/config");
  const { close } = openModal([], {});
  const host = h("input", { class: "input", value: config.github.host });
  const auth = h("select", { class: "select" }, ["auto", "gh-token", "logged-in-user"].map((value) => h("option", { value, text: { auto: "Automático (token de gh, luego sesión del runtime)", "gh-token": "Token de la sesión gh", "logged-in-user": "Sesión del runtime Copilot" }[value], selected: config.copilot.auth === value })));
  const outputs = h("input", { class: "input mono", value: config.paths.outputs });
  const kbs = h("input", { class: "input mono", value: config.paths.knowledgeBases });
  const prefix = h("input", { class: "input", value: config.work.branchPrefix });
  const browser = h("select", { class: "select" }, ["chrome", "default"].map((value) => h("option", { value, text: value === "chrome" ? "Chrome (pestaña nueva)" : "Navegador predeterminado", selected: config.ui.browser === value })));
  document.querySelector(".modal").append(
    modalHeader("Ajustes", close, "Configuración local"),
    h("div", { class: "bento bento--2" },
      h("div", { class: "field" }, h("label", { text: "Host de GitHub Enterprise" }), host),
      h("div", { class: "field" }, h("label", { text: "Autenticación de Copilot" }), auth),
      h("div", { class: "field" }, h("label", { text: "Carpeta de salidas" }), h("div", { class: "form-row" }, outputs, h("button", { class: "btn btn--outline btn--sm", text: "Elegir", onclick: async () => { const folder = await pickFolder({ title: "Carpeta de salidas" }); if (folder) outputs.value = folder; } }))),
      h("div", { class: "field" }, h("label", { text: "Carpeta por defecto para nuevas bases" }), h("div", { class: "form-row" }, kbs, h("button", { class: "btn btn--outline btn--sm", text: "Elegir", onclick: async () => { const folder = await pickFolder({ title: "Carpeta de bases de conocimiento" }); if (folder) kbs.value = folder; } }))),
      h("div", { class: "field" }, h("label", { text: "Prefijo de ramas de trabajo" }), prefix),
      h("div", { class: "field" }, h("label", { text: "Navegador" }), browser)),
    h("dl", { class: "kv" }, h("dt", { text: "Datos" }), h("dd", { class: "mono", text: state.status?.paths?.dataRoot || "" }), h("dt", { text: "Versión" }), h("dd", { text: config.product.version })),
    h("div", { class: "card__actions", style: { justifyContent: "flex-end" } },
      h("button", { class: "btn btn--outline", text: "Cerrar sesión de GitHub", onclick: async () => { if (await confirmDialog("Cerrar sesión", "Se cerrará la sesión de gh en este equipo.", { okLabel: "Cerrar sesión", danger: true })) { await post("/api/auth/logout"); close(); await refreshStatus(); } } }),
      h("button", { class: "btn", text: "Guardar", onclick: async () => {
        try {
          await put("/api/config", { github: { host: host.value.trim() }, copilot: { host: host.value.trim(), auth: auth.value }, paths: { outputs: outputs.value.trim(), knowledgeBases: kbs.value.trim() }, work: { branchPrefix: prefix.value.trim() }, ui: { browser: browser.value } });
          toast("Ajustes guardados", "ok");
          close();
          await refreshStatus();
          await loadModels({ refresh: true });
        } catch (error) {
          toast(error.message, "error");
        }
      } })),
  );
}

/* ---------- Router ---------- */
const VIEWS = { knowledge: renderKnowledge, assistant: renderAssistant, work: renderWork };
let currentView = null;

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [route, ...rest] = hash.split("/");
  return { route: VIEWS[route] ? route : "knowledge", params: rest };
}

export function navigate(path) {
  location.hash = path.startsWith("#") ? path : `#/${path.replace(/^\//, "")}`;
}

export function setBreadcrumb(...parts) {
  const node = document.getElementById("breadcrumb");
  clear(node);
  node.append(h("span", { text: "DORIATH" }));
  parts.filter(Boolean).forEach((part, index) => node.append(h("span", { class: index === parts.length - 1 ? "breadcrumb__sub" : "", text: String(part).toUpperCase() })));
}

async function renderRoute() {
  const { route, params } = parseHash();
  state.route = route;
  state.routeParams = params;
  document.querySelectorAll(".navlink").forEach((link) => link.classList.toggle("is-active", link.dataset.route === route));
  const view = document.getElementById("view");
  currentView?.destroy?.();
  clear(view);
  try {
    currentView = await VIEWS[route]({ container: view, params, state });
  } catch (error) {
    console.error(error);
    view.append(h("div", { class: "callout callout--error", text: `No se pudo cargar la vista: ${error.message}` }));
  }
}

window.addEventListener("hashchange", renderRoute);

async function boot() {
  document.getElementById("btnManageSources").addEventListener("click", openSourcesManager);
  document.getElementById("btnSettings").addEventListener("click", openSettings);
  await refreshSources().catch((error) => toast(error.message, "error"));
  await refreshStatus({ copilot: false }).catch((error) => toast(error.message, "error"));
  await renderRoute();
  refreshStatus().then(() => loadModels()).catch(() => undefined);
}

boot();
