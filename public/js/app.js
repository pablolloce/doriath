/** KDD Studio — aplicación (shell, navegación, bases de conocimiento, sesión). */
import { get, post, put, del } from "./api.js";
import { h, clear, toast, openModal, modalHeader, confirmDialog, promptDialog, pickFolder, fmtDate } from "./ui.js";
import { renderKnowledge } from "./views/knowledge.js";
import { renderMyKnowledge } from "./views/my-knowledge.js";
import { renderAssistant } from "./views/assistant.js";
import { renderWork } from "./views/work.js";

export const state = {
  status: null,
  sources: [],
  activeSourceId: localStorage.getItem("kdd.activeSource") || "",
  models: null,
  model: localStorage.getItem("kdd.model") || "auto",
  route: "knowledge",
  routeParams: {},
  gateOpen: false,
  gateDismissed: false,
  // "user": quien aporta documentos y pregunta. "admin": quien mantiene la base de conocimiento.
  role: localStorage.getItem("kdd.role") === "admin" ? "admin" : "user",
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
    localStorage.setItem("kdd.activeSource", state.activeSourceId);
  }
  renderSourceMenu();
  notify();
  return state.sources;
}

export function setActiveSource(id) {
  state.activeSourceId = id;
  localStorage.setItem("kdd.activeSource", id);
  post(`/api/sources/${id}/touch`).catch(() => undefined);
  renderSourceMenu();
  notify();
  renderRoute();
}

/* ---------- Rol y navegación ---------- */
// Cada rol ve su propio menú: el usuario no entra en el mantenimiento de la base.
const ROUTES = {
  user: [
    { id: "knowledge", label: "My Knowledge Bases", hint: "Tus documentos y tus respuestas" },
    { id: "assistant", label: "BBVA CIB Assistant", hint: "Conversación y entregables" },
    { id: "work", label: "Knowledge-Driven Development", hint: "Iniciativas, repositorios y cambios" },
  ],
  admin: [
    { id: "knowledge", label: "Knowledge Bases Studio", hint: "Specs, gobernanza y salud" },
    { id: "assistant", label: "BBVA CIB Assistant", hint: "Conversación y entregables" },
    { id: "work", label: "Knowledge-Driven Development", hint: "Iniciativas, repositorios y cambios" },
  ],
};

export function isAdmin() {
  return state.role === "admin" && canManageKnowledge();
}

/** La edición manda sobre el rol: KDD Assistant no tiene los módulos que el rol usuario sí vería. */
function routesForEdition() {
  const allowed = state.status?.edition?.modules;
  const routes = ROUTES[state.role] || ROUTES.user;
  return allowed ? routes.filter((route) => allowed.includes(route.id)) : routes;
}

function renderNav() {
  const nav = document.getElementById("nav");
  clear(nav);
  routesForEdition().forEach((route, index) => {
    nav.append(h("a", { class: `navlink${route.id === state.route ? " is-active" : ""}`, href: `#/${route.id}`, dataset: { route: route.id } },
      h("span", { class: "navlink__index", text: String(index + 1).padStart(2, "0") }),
      h("span", { class: "navlink__label", text: route.label }),
      h("span", { class: "navlink__hint", text: route.hint })));
  });
}

/** ¿Esta edición mantiene la base, o solo la consulta? Decide el menú de rol y la jerga de specs. */
export function canManageKnowledge() {
  return state.status?.edition?.canManageKnowledge !== false;
}

function renderRolePicker() {
  const picker = document.getElementById("rolePicker");
  clear(picker);
  // KDD Assistant no administra la base: el rol admin no tendría nada que abrir, así que no se ofrece.
  if (!canManageKnowledge()) {
    picker.hidden = true;
    if (state.role === "admin") {
      state.role = "user";
      localStorage.setItem("kdd.role", "user");
    }
    return;
  }
  picker.hidden = false;
  for (const [id, label] of [["user", "Usuario"], ["admin", "Admin"]]) {
    picker.append(h("button", { class: state.role === id ? "is-active" : "", text: label, onclick: () => setRole(id) }));
  }
}

function setRole(role) {
  if (state.role === role) return;
  state.role = role;
  localStorage.setItem("kdd.role", role);
  renderRolePicker();
  renderNav();
  renderSourceMenu();
  toast(role === "admin" ? "Modo administrador: mantenimiento de la base de conocimiento." : "Modo usuario: importar documentos y preguntar.");
  // La pantalla de conocimiento cambia por completo entre roles; el resto se repinta igual.
  renderRoute();
}

/**
 * Selector de base de conocimiento para encabezar las vistas: primero eliges sobre cuál trabajas y
 * después viene el menú de la propia vista.
 */
export function kbPicker({ expert = false, label = "Elige tu base de conocimiento" } = {}) {
  const wrapper = h("div", { style: { marginBottom: "var(--space-3)" } },
    h("p", { class: "kb-picker__label", text: label }),
    h("div", { class: "kb-picker" },
      ...state.sources.map((source) => h("button", {
        class: `kb-chip${source.id === state.activeSourceId ? " is-active" : ""}${source.exists ? "" : " is-missing"}`,
        title: source.path,
        onclick: () => {
          if (!source.exists) { toast("Esa carpeta no está disponible en este equipo.", "error"); return; }
          if (source.id === state.activeSourceId) return;
          setActiveSource(source.id);
        },
      },
      h("span", { class: "kb-chip__name" }, h("span", { class: "kb-chip__dot" }), source.name),
      h("span", { class: "kb-chip__meta", text: !source.exists ? "carpeta no disponible"
        : expert ? `${source.sourceId} · ${source.stats?.specs ?? 0} specs · ${source.stats?.documents ?? 0} docs`
          : `${source.stats?.documents ?? 0} documento${(source.stats?.documents ?? 0) === 1 ? "" : "s"}` }))),
      h("button", { class: "kb-chip kb-chip--add", text: "+ Añadir otra", onclick: openSourcesManager })));
  return wrapper;
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
      h("div", { class: "source-item__meta", text: !source.exists ? "carpeta no disponible"
        : isAdmin() ? `${source.sourceId} · ${specs} specs · ${source.stats?.documents ?? 0} docs`
          : `${source.stats?.documents ?? 0} documento${(source.stats?.documents ?? 0) === 1 ? "" : "s"}` }))));
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
          h("div", { class: "list-item__meta", text: !source.exists ? "La carpeta no existe en este equipo"
            : canManageKnowledge() ? `${source.stats?.specs ?? 0} specs · ${source.stats?.documents ?? 0} documentos · ${source.stats?.relations ?? 0} relaciones`
              : `${source.stats?.documents ?? 0} documento${(source.stats?.documents ?? 0) === 1 ? "" : "s"}` })),
        h("div", { class: "card__actions" },
          h("button", { class: "btn btn--outline btn--sm", text: "Renombrar", onclick: async () => { const name = await promptDialog("Renombrar base de conocimiento", { label: "Nombre", value: source.name }); if (name) { await put(`/api/sources/${source.id}`, { name }); await refreshSources(); render(); } } }),
          h("button", { class: "btn btn--outline btn--sm", text: "Abrir carpeta", onclick: () => post("/api/open", { path: source.path }).catch((error) => toast(error.message, "error")) }),
          h("button", { class: "btn btn--danger btn--sm", text: "Quitar", onclick: async () => { if (await confirmDialog("Quitar del registro", `Se quitará "${source.name}" de ${state.status?.edition?.name || "KDD Studio"}. La carpeta y sus specs no se borran.`, { okLabel: "Quitar", danger: true })) { await del(`/api/sources/${source.id}`); await refreshSources(); render(); } } }))));
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
      h("button", { class: "btn btn--outline", text: "Escribir ruta a mano", onclick: async () => { const value = await promptDialog("Ruta de la carpeta", { label: "Ruta", placeholder: "C:\\Proyectos\\kb-riesgos" }); if (!value) return; try { const result = await post("/api/sources/add", { path: value }); toast(result.created ? `Base de conocimiento añadida: ${result.source.name}` : "Esa carpeta ya estaba registrada.", "ok"); await refreshSources(); if (result.created) setActiveSource(result.source.id); render(); } catch (error) { toast(error.message, "error", 7000); } } })),
    body,
  );
  render();
}

/* ---------- Sesión y estado ---------- */
export async function refreshStatus({ copilot = true, refresh = false } = {}) {
  state.status = await get(`/api/status?copilot=${copilot ? "1" : "0"}${refresh ? "&refresh=1" : ""}`);
  renderSession();
  renderGate();
  return state.status;
}

function renderSession() {
  const badge = document.getElementById("sessionBadge");
  clear(badge);
  if (state.status?.edition?.provider === "codex") return renderCodexSession(badge);
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

/** El mismo badge, pero contando la sesión de ChatGPT que abre `codex login`. */
function renderCodexSession(badge) {
  const codex = state.status?.codex;
  if (!codex) return;
  if (!codex.installed) {
    badge.append(h("div", { class: "session__avatar", text: "!" }), h("div", {}, h("div", { class: "session__name", text: "Codex no encontrado" }), h("div", { class: "session__state", text: "Vuelve a ejecutar el instalador" })));
    return;
  }
  if (!codex.authenticated) {
    badge.append(h("div", { class: "session__avatar", text: "?" }), h("div", {}, h("div", { class: "session__name", text: "Sin sesión" }), h("button", { class: "btn btn--accent btn--xs", text: "Iniciar sesión con ChatGPT", onclick: startCodexLogin })));
    return;
  }
  const name = codex.account || "ChatGPT";
  const initials = name.split(/[\s@.]+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "GPT";
  badge.append(
    h("div", { class: "session__avatar", text: initials }),
    h("div", {}, h("div", { class: "session__name", text: name }), h("div", { class: "session__state", text: codex.version || "ChatGPT" })),
  );
}

async function startCodexLogin() {
  try {
    const result = await post("/api/codex/login", {});
    toast(result.hint || "Se ha abierto la consola de inicio de sesión.", "info", 8000);
    pollAuth();
  } catch (error) {
    toast(error.message, "error");
  }
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
  // El login ocurre en otra consola: se sondea hasta que la sesión aparece, o hasta rendirse.
  const codex = state.status?.edition?.provider === "codex";
  const endpoint = codex ? "/api/codex/status?refresh=1" : "/api/auth/status?refresh=1";
  let attempts = 0;
  authPoll = setInterval(async () => {
    attempts += 1;
    const auth = await get(endpoint).catch(() => null);
    if (auth?.authenticated || attempts > 90) {
      clearInterval(authPoll);
      if (auth?.authenticated) {
        toast(codex ? `Sesión de ChatGPT iniciada${auth.account ? `: ${auth.account}` : ""}` : `Sesión iniciada como ${auth.user?.name || auth.login}`, "ok");
        if (!codex) await post("/api/auth/refresh").catch(() => undefined);
        await refreshStatus({ refresh: true });
        await loadModels();
      }
    }
  }, 4000);
}

function closeGate() {
  document.getElementById("gate")?.remove();
  const overlay = document.getElementById("overlay");
  if (overlay && !overlay.querySelector(".modal")) {
    overlay.hidden = true;
    overlay.replaceChildren();
  }
  state.gateOpen = false;
}

/**
 * Puerta de sesión de KDD Assistant. La sesión la abre `codex login` contra ChatGPT: aquí solo se
 * lanza y se comprueba. Se avisa del cupo compartido porque agotarlo aquí deja a la persona sin
 * ChatGPT el resto de la ventana, y eso no debería ser una sorpresa.
 */
function renderCodexGate() {
  const codex = state.status?.codex;
  const needsGate = codex && (!codex.installed || !codex.authenticated);
  if (!needsGate) {
    if (document.getElementById("gate")) closeGate();
    state.gateDismissed = false;
    return;
  }
  if (state.gateDismissed || document.getElementById("gate")) return;
  state.gateOpen = true;
  const overlay = document.getElementById("overlay");
  overlay.hidden = false;
  overlay.onclick = null;
  const build = state.status?.build;
  const detail = [
    codex.executable ? `Codex: ${codex.executable}` : "",
    codex.version ? `Versión: ${codex.version}` : "",
    build?.version ? `KDD Assistant ${build.version}${build.commit ? ` · ${build.commit}` : ""}` : "",
    codex.authOutput || codex.error || "",
  ].filter(Boolean).join("\n");

  const gate = h("div", { class: "gate", id: "gate" },
    h("img", { class: "gate__mark", src: "/brand/kdd-mark-white.png", alt: "" }),
    h("p", { class: "ante-title", text: "KDD Assistant" }),
    h("h1", { text: codex.installed ? "Inicia sesión con ChatGPT" : "Falta Codex" }),
    h("p", { class: "lead", style: { marginTop: "10px" }, text: codex.installed
      ? "KDD Assistant usa tu cuenta de ChatGPT. Se abrirá una consola para que inicies sesión; cuando termines, vuelve aquí y pulsa Comprobar."
      : "No se ha encontrado Codex. Vuelve a ejecutar el instalador de KDD Assistant, que lo trae incluido." }),
    h("div", { class: "card__actions", style: { marginTop: "16px" } },
      codex.installed ? h("button", { class: "btn btn--accent", text: "Iniciar sesión con ChatGPT", onclick: async () => {
        try {
          const result = await post("/api/codex/login", {});
          toast(result.hint || "Se ha abierto la consola de inicio de sesión.", "ok", 8000);
        } catch (error) { toast(error.message, "error", 7000); }
      } }) : null,
      h("button", { class: "btn btn--outline", style: { color: "#85C8FF", borderColor: "#85C8FF" }, text: "Comprobar", onclick: () => refreshStatus({ refresh: true }) }),
      h("button", { class: "btn btn--ghost", style: { color: "#85C8FF" }, text: "Continuar sin sesión", onclick: () => { state.gateDismissed = true; closeGate(); } })),
    h("div", { class: "gate__detail" },
      h("p", { class: "ante-title", style: { marginTop: "14px" }, text: "El cupo es el de tu plan" }),
      h("p", { class: "small", style: { opacity: 0.85 }, text: "Las respuestas consumen el cupo de tu plan de ChatGPT, en una ventana de 5 horas que compartes con tu propio ChatGPT y con tu IDE." })),
    detail ? h("pre", { class: "gate__output", text: detail }) : null,
  );
  overlay.replaceChildren(gate);
}

function renderGate() {
  if (state.status?.edition?.provider === "codex") return renderCodexGate();
  const github = state.status?.github;
  const needsGate = github && (!github.installed || !github.authenticated);
  if (!needsGate) {
    if (document.getElementById("gate")) closeGate();
    state.gateDismissed = false;
    return;
  }
  // Si el usuario ya la ha cerrado con "Continuar sin sesión", no se le vuelve a poner delante en
  // cada refresco: se queda el botón de iniciar sesión en la barra lateral.
  if (state.gateDismissed || document.getElementById("gate")) return;
  state.gateOpen = true;
  const overlay = document.getElementById("overlay");
  overlay.hidden = false;
  overlay.onclick = null;
  const build = state.status?.build;
  const detail = [
    `Host configurado: ${github.host}`,
    github.executable ? `GitHub CLI: ${github.executable}` : "",
    build ? `KDD-Studio ${build.version}${build.commit ? ` · commit ${build.commit}` : ""}${build.builtAt ? ` · construido ${new Date(build.builtAt).toLocaleString("es-ES")}` : " · ejecutando desde el código fuente"}` : "",
    build?.root ? `Instalación: ${build.root}` : "",
    github.otherHosts?.length ? `Hay sesión de gh en: ${github.otherHosts.join(", ")}. KDD Studio busca ${github.host}; cámbialo en Ajustes si no es el correcto.` : "",
    github.authOutput || github.error || "",
  ].filter(Boolean).join("\n");
  overlay.replaceChildren(h("div", { class: "gate", id: "gate" },
    h("img", { src: "/brand/kdd-mark-white.png", alt: "", class: "gate__mark" }),
    h("div", {}, h("p", { class: "ante-title", text: "KDD Studio · BBVA CIB" }), h("h1", { text: github.installed ? "Inicia sesión en GitHub" : "Falta GitHub CLI" })),
    h("p", { class: "lead", text: github.installed
      ? `KDD-Studio usa tu sesión corporativa de GitHub (${github.host}) para acceder a los repositorios y a GitHub Copilot. Al pulsar el botón se abrirá una consola y el navegador para completar el inicio de sesión con tu correo de BBVA.`
      : "No se ha encontrado la CLI de GitHub (gh). Instálala o vuelve a ejecutar el instalador de KDD Studio, y después pulsa Reintentar." }),
    h("div", { class: "card__actions" },
      github.installed ? h("button", { class: "btn btn--accent", text: "Iniciar sesión en GitHub", onclick: startLogin }) : null,
      h("button", { class: "btn btn--outline", style: { color: "#F7F8F8", borderColor: "#85C8FF" }, text: "Reintentar", onclick: async () => { try { await refreshStatus({ refresh: true }); } catch (error) { toast(error.message, "error"); } } }),
      h("button", { class: "btn btn--ghost", style: { color: "#85C8FF" }, text: "Continuar sin sesión", onclick: () => { state.gateDismissed = true; closeGate(); } })),
    detail ? h("div", { class: "gate__detail" },
      h("p", { class: "ante-title", style: { color: "#85C8FF" }, text: "Qué ve KDD Studio al comprobar la sesión" }),
      h("pre", { class: "gate__output", text: detail })) : null,
    h("p", { class: "small", style: { opacity: 0.8 }, text: `También puedes ejecutarlo a mano: gh auth login --hostname ${github.host} --web --git-protocol https` }),
  ));
}

/* ---------- Modelos ---------- */
export async function loadModels({ refresh = false } = {}) {
  const picker = document.getElementById("modelPicker");
  // Con Codex el modelo lo elige la CLI según el plan de ChatGPT: aquí no hay nada que elegir.
  if (state.status?.edition?.provider === "codex") {
    state.models = null;
    state.model = "auto";
    picker.replaceChildren();
    picker.hidden = true;
    return;
  }
  picker.hidden = false;
  try {
    state.models = await get(`/api/models${refresh ? "?refresh=1" : ""}`);
  } catch (error) {
    state.models = null;
    picker.replaceChildren(h("span", { class: "chip chip--outline", title: error.message, text: "Copilot no disponible" }));
    return;
  }
  const select = h("select", { onchange: (event) => { state.model = event.target.value; localStorage.setItem("kdd.model", state.model); notify(); } },
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
  // KDD Assistant no habla con GitHub ni ejecuta trabajo: de los ajustes solo le tocan las carpetas.
  const codex = state.status?.edition?.provider === "codex";
  const host = h("input", { class: "input", value: config.github.host });
  const auth = h("select", { class: "select" }, ["auto", "gh-token", "logged-in-user"].map((value) => h("option", { value, text: { auto: "Automático (token de gh, luego sesión del runtime)", "gh-token": "Token de la sesión gh", "logged-in-user": "Sesión del runtime Copilot" }[value], selected: config.copilot.auth === value })));
  const outputs = h("input", { class: "input mono", value: config.paths.outputs });
  const kbs = h("input", { class: "input mono", value: config.paths.knowledgeBases });
  const prefix = h("input", { class: "input", value: config.work.branchPrefix });
  const browser = h("select", { class: "select" }, ["chrome", "default"].map((value) => h("option", { value, text: value === "chrome" ? "Chrome (pestaña nueva)" : "Navegador predeterminado", selected: config.ui.browser === value })));
  document.querySelector(".modal").append(
    modalHeader("Ajustes", close, "Configuración local"),
    h("div", { class: "bento bento--2" },
      codex ? null : h("div", { class: "field" }, h("label", { text: "Host de GitHub Enterprise" }), host),
      codex ? null : h("div", { class: "field" }, h("label", { text: "Autenticación de Copilot" }), auth),
      h("div", { class: "field" }, h("label", { text: "Carpeta de salidas" }), h("div", { class: "form-row" }, outputs, h("button", { class: "btn btn--outline btn--sm", text: "Elegir", onclick: async () => { const folder = await pickFolder({ title: "Carpeta de salidas" }); if (folder) outputs.value = folder; } }))),
      h("div", { class: "field" }, h("label", { text: "Carpeta por defecto para nuevas bases" }), h("div", { class: "form-row" }, kbs, h("button", { class: "btn btn--outline btn--sm", text: "Elegir", onclick: async () => { const folder = await pickFolder({ title: "Carpeta de bases de conocimiento" }); if (folder) kbs.value = folder; } }))),
      codex ? null : h("div", { class: "field" }, h("label", { text: "Prefijo de ramas de trabajo" }), prefix),
      h("div", { class: "field" }, h("label", { text: "Navegador" }), browser)),
    h("dl", { class: "kv" },
      h("dt", { text: "Datos" }), h("dd", { class: "mono", text: state.status?.paths?.dataRoot || "" }),
      h("dt", { text: "Instalación" }), h("dd", { class: "mono", text: state.status?.build?.root || "" }),
      h("dt", { text: "Versión" }), h("dd", { text: `${config.product.version}${state.status?.build?.commit ? ` · commit ${state.status.build.commit}` : ""}${state.status?.build?.builtAt ? ` · construido ${new Date(state.status.build.builtAt).toLocaleString("es-ES")}` : " · desde el código fuente"}` }),
      h("dt", { text: codex ? "Codex" : "GitHub CLI" }), h("dd", { class: "mono", text: (codex ? state.status?.codex?.executable : state.status?.github?.executable) || "no encontrada" })),
    h("div", { class: "card__actions", style: { justifyContent: "flex-end" } },
      codex
        ? h("button", { class: "btn btn--outline", text: "Cerrar sesión de ChatGPT", onclick: async () => { if (await confirmDialog("Cerrar sesión", "Se cerrará la sesión de ChatGPT en este equipo.", { okLabel: "Cerrar sesión", danger: true })) { await post("/api/codex/logout", {}); close(); await refreshStatus({ refresh: true }); } } })
        : h("button", { class: "btn btn--outline", text: "Cerrar sesión de GitHub", onclick: async () => { if (await confirmDialog("Cerrar sesión", "Se cerrará la sesión de gh en este equipo.", { okLabel: "Cerrar sesión", danger: true })) { await post("/api/auth/logout"); close(); await refreshStatus(); } } }),
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
const viewFor = (route) => (route === "knowledge" && !isAdmin() ? renderMyKnowledge : VIEWS[route]);
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
  node.append(h("span", { text: (state.status?.edition?.name || "KDD Studio").toUpperCase() }));
  parts.filter(Boolean).forEach((part, index) => node.append(h("span", { class: index === parts.length - 1 ? "breadcrumb__sub" : "", text: String(part).toUpperCase() })));
}

async function renderRoute() {
  const { route, params } = parseHash();
  const available = routesForEdition();
  // Un enlace guardado puede apuntar a un módulo que esta edición no trae: se cae al primero suyo.
  state.route = available.some((item) => item.id === route) ? route : (available[0]?.id || route);
  state.routeParams = params;
  renderNav();
  const view = document.getElementById("view");
  currentView?.destroy?.();
  clear(view);
  try {
    currentView = await viewFor(state.route)({ container: view, params, state });
  } catch (error) {
    console.error(error);
    view.append(h("div", { class: "callout callout--error", text: `No se pudo cargar la vista: ${error.message}` }));
  }
}

window.addEventListener("hashchange", renderRoute);

async function boot() {
  document.getElementById("btnManageSources").addEventListener("click", openSourcesManager);
  document.getElementById("btnSettings").addEventListener("click", openSettings);
  renderRolePicker();
  renderNav();
  await refreshSources().catch((error) => toast(error.message, "error"));
  await refreshStatus({ copilot: false }).catch((error) => toast(error.message, "error"));
  await renderRoute();
  refreshStatus().then(() => loadModels()).catch(() => undefined);
}

boot();
