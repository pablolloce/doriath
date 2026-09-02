/** Knowledge-Driven Development: iniciativas (chat Work), repositorios locales y ejecución con git. */
import { get, post, put, del, subscribe } from "../api.js";
import { h, md, clear, toast, confirmDialog, promptDialog, pickFolder, fmtDate, statusChip, layerChip, renderDiff, openModal, modalHeader } from "../ui.js";
import { createChatView } from "../chat.js";
import { renderPackagePanel } from "../package-panel.js";
import { setBreadcrumb, activeSource, openSourcesManager, refreshSources, state as appState } from "../app.js";

const TABS = [["initiatives", "1 · Iniciativa"], ["repositories", "2 · Repositorios"], ["execution", "3 · Ejecución"]];

export async function renderWork({ container, params, state }) {
  const source = activeSource();
  setBreadcrumb("Knowledge-Driven Development", source?.name);
  if (!source) {
    container.append(h("div", { class: "card card--electric" }, h("p", { class: "ante-title", text: "Knowledge-Driven Development" }), h("h1", { text: "Selecciona una base de conocimiento" }), h("p", { class: "lead", style: { marginTop: "12px" }, text: "El desarrollo parte del conocimiento: elige la caja cuyas specs guiarán la iniciativa." }), h("div", { class: "card__actions", style: { marginTop: "20px" } }, h("button", { class: "btn btn--accent", text: "Gestionar bases de conocimiento", onclick: openSourcesManager }))));
    return {};
  }
  const layers = state.layers || [];
  let tab = params[0] || localStorage.getItem("doriath.workTab") || "initiatives";
  const tabsNode = h("div", { class: "tabs" });
  const body = h("div");
  container.append(
    h("div", { class: "card card--electric" }, h("p", { class: "ante-title", text: `Knowledge-Driven Development · ${source.sourceId}` }), h("h1", { text: source.name }), h("p", { class: "small", style: { marginTop: "8px", opacity: 0.85 }, text: "Describe el cambio, el asistente detecta el conocimiento y los repositorios necesarios, acordáis un plan con tareas y Doriath ejecuta cada tarea sobre tus repositorios locales con revisión del diff antes de cada commit." })),
    tabsNode,
    body,
  );
  let cleanup = null;
  function renderTabs() {
    clear(tabsNode);
    for (const [id, label] of TABS) tabsNode.append(h("button", { class: `tab${tab === id ? " is-active" : ""}`, text: label, onclick: () => selectTab(id) }));
  }
  async function selectTab(id, extra) {
    tab = id;
    localStorage.setItem("doriath.workTab", id);
    renderTabs();
    cleanup?.();
    cleanup = null;
    clear(body);
    const renderers = { initiatives: renderInitiatives, repositories: renderRepositories, execution: renderExecution };
    try {
      cleanup = await renderers[id](body, extra);
    } catch (error) {
      body.append(h("div", { class: "callout callout--error", text: error.message }));
    }
  }

  /* ---------- Repositorios ---------- */
  async function loadRepos(refresh = false) {
    return (await get(`/api/sources/${source.id}/repositories${refresh ? "?refresh=1" : ""}`)).repositories;
  }

  function repoCard(repo, actions) {
    return h("div", { class: "list-item", style: { alignItems: "flex-start" } },
      h("div", { class: "list-item__main" },
        h("div", { class: "list-item__title" }, repo.name, " ", repo.exists === false ? h("span", { class: "chip chip--mandarin", text: "no existe" }) : null),
        h("div", { class: "list-item__meta mono", text: repo.path }),
        h("div", { class: "chips", style: { marginTop: "4px" } }, repo.branch ? h("span", { class: "chip chip--serene", text: repo.branch }) : null, ...(repo.stacks || []).map((stack) => h("span", { class: "chip chip--ice", text: stack.label })), repo.dirty ? h("span", { class: "chip chip--canary", text: `${repo.dirty} cambios sin confirmar` }) : null),
        repo.lastCommit ? h("div", { class: "list-item__meta", text: repo.lastCommit }) : null),
      h("div", { class: "card__actions" }, actions));
  }

  async function renderRepositories(node) {
    const registeredNode = h("div", { class: "list" });
    const scanNode = h("div", { class: "list" });
    const foldersNode = h("div", { class: "chips" });
    const folders = [];
    let found = [];
    async function refreshRegistered() {
      const repos = await loadRepos(true);
      clear(registeredNode);
      if (!repos.length) registeredNode.append(h("div", { class: "empty small", text: "Sin repositorios registrados para esta base de conocimiento." }));
      for (const repo of repos) registeredNode.append(repoCard(repo, [h("button", { class: "btn btn--danger btn--xs", text: "Quitar", onclick: async () => { await del(`/api/sources/${source.id}/repositories/${repo.id}`); refreshRegistered(); } })]));
    }
    function renderFolders() {
      clear(foldersNode);
      folders.forEach((folder, index) => foldersNode.append(h("span", { class: "file-chip" }, folder, h("button", { text: "×", onclick: () => { folders.splice(index, 1); renderFolders(); } }))));
    }
    async function scan() {
      if (!folders.length) { toast("Selecciona al menos una carpeta.", "error"); return; }
      clear(scanNode);
      scanNode.append(h("div", { class: "muted small" }, h("span", { class: "spinner" }), " Buscando repositorios (.git)…"));
      try {
        const data = await post("/api/repositories/scan", { paths: folders });
        found = data.repositories;
        clear(scanNode);
        if (!found.length) { scanNode.append(h("div", { class: "empty small", text: "No se encontraron repositorios Git en esas carpetas (se buscan hasta 3 niveles)." })); return; }
        const selected = new Set(found.map((repo) => repo.path));
        scanNode.append(h("div", { class: "list" }, found.map((repo) => h("div", { class: "list-item" }, h("label", { class: "checkbox" }, h("input", { type: "checkbox", checked: true, onchange: (event) => { if (event.target.checked) selected.add(repo.path); else selected.delete(repo.path); } })), h("div", { class: "list-item__main", style: { flex: 1 } }, h("div", { class: "list-item__title", text: repo.name }), h("div", { class: "list-item__meta mono", text: repo.path }), h("div", { class: "chips" }, repo.branch ? h("span", { class: "chip chip--serene", text: repo.branch }) : null, ...(repo.stacks || []).map((stack) => h("span", { class: "chip chip--ice", text: stack.label }))))))),
          h("button", { class: "btn btn--lime", style: { marginTop: "12px" }, text: "Registrar seleccionados", onclick: async () => { const result = await post(`/api/sources/${source.id}/repositories`, { repositories: found.filter((repo) => selected.has(repo.path)) }); toast(`${result.repositories.length} repositorio(s) registrados`, "ok"); clear(scanNode); folders.splice(0); renderFolders(); refreshRegistered(); } }));
      } catch (error) {
        clear(scanNode);
        scanNode.append(h("div", { class: "callout callout--error", text: error.message }));
      }
    }
    node.append(h("div", { class: "bento bento--main-aside" },
      h("div", { class: "card" }, h("div", { class: "card__header" }, h("div", {}, h("p", { class: "ante-title", text: "Repositorios registrados" }), h("h2", { text: "Clones locales" })), h("button", { class: "btn btn--outline btn--sm", text: "Actualizar", onclick: refreshRegistered })), registeredNode),
      h("div", { class: "card card--serene" }, h("p", { class: "ante-title", text: "Detectar repositorios" }), h("h3", { text: "Selecciona carpetas" }), h("p", { class: "small", style: { margin: "8px 0 12px" }, text: "Elige la carpeta raíz donde tienes clonados los repositorios (o cada repositorio). Doriath busca las carpetas .git y trabaja directamente sobre ellas." }),
        h("div", { class: "card__actions" }, h("button", { class: "btn", text: "Elegir carpeta", onclick: async () => { const folder = await pickFolder({ title: "Carpeta con repositorios" }); if (folder && !folders.includes(folder)) { folders.push(folder); renderFolders(); } } }), h("button", { class: "btn btn--outline", text: "Escribir ruta", onclick: async () => { const value = await promptDialog("Ruta de la carpeta", { label: "Ruta" }); if (value && !folders.includes(value)) { folders.push(value); renderFolders(); } } })),
        h("div", { style: { margin: "12px 0" } }, foldersNode),
        h("button", { class: "btn btn--lime", text: "Buscar repositorios", onclick: scan }),
        h("div", { style: { marginTop: "12px" } }, scanNode))));
    await refreshRegistered();
  }

  /* ---------- Iniciativas (chat Work) ---------- */
  async function renderInitiatives(node) {
    const chatHost = h("div");
    const packageHost = h("div");
    const listNode = h("div", { class: "list" });
    const reposNode = h("div", { class: "list" });
    let view = null;
    node.append(h("div", { class: "bento", style: { gridTemplateColumns: "280px minmax(0, 1fr) 380px", alignItems: "start" } },
      h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
        h("div", { class: "card card--serene" }, h("p", { class: "ante-title", text: "Paso 1" }), h("h3", { text: "Describe el cambio" }), h("p", { class: "small", style: { margin: "8px 0 12px" }, text: "El asistente entrevista, activa el conocimiento de la caja, detecta los repositorios implicados y propone la iniciativa con su plan y tareas." }), h("button", { class: "btn", text: "Nueva iniciativa", onclick: () => startChat() })),
        h("div", { class: "card" }, h("p", { class: "ante-title", text: "Iniciativas en curso" }), listNode)),
      chatHost,
      h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } }, h("div", { class: "card" }, h("div", { class: "card__header" }, h("p", { class: "ante-title", text: "Repositorios de la iniciativa" }), h("button", { class: "btn btn--ghost btn--xs", text: "Gestionar", onclick: () => selectTab("repositories") })), reposNode), packageHost)));
    async function refreshList(currentId) {
      const data = await get(`/api/chats?kind=work&sourceId=${source.id}`);
      clear(listNode);
      if (!data.chats.length) listNode.append(h("div", { class: "muted small", text: "Sin iniciativas todavía." }));
      for (const chat of data.chats) listNode.append(h("div", { class: `list-item is-clickable${chat.id === currentId ? " is-active" : ""}`, onclick: () => openChat(chat.id) }, h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: chat.title }), h("div", { class: "list-item__meta", text: `${chat.phase || "inicio"} · ${fmtDate(chat.updatedAt)}` })), chat.hasPackage ? h("span", { class: "chip chip--canary", text: "paquete" }) : null, h("button", { class: "btn btn--ghost btn--xs", text: "×", onclick: async (event) => { event.stopPropagation(); if (await confirmDialog("Eliminar", "Se elimina la conversación (no las specs ya persistidas).", { okLabel: "Eliminar", danger: true })) { await del(`/api/chats/${chat.id}`); refreshList(); if (view?.chat?.id === chat.id) { clear(chatHost); clear(packageHost); } } } })));
    }
    async function renderRepos(chat) {
      const repos = await loadRepos();
      clear(reposNode);
      if (!repos.length) { reposNode.append(h("div", { class: "muted small", text: "No hay repositorios registrados. Selecciónalos en el paso 2 para que el asistente pueda inspeccionarlos." })); return; }
      const detected = (chat?.state?.repositories || []).map((name) => name.toLowerCase());
      for (const repo of repos) {
        const checked = !chat?.repoIds?.length || chat.repoIds.includes(repo.id);
        reposNode.append(h("label", { class: "checkbox", style: { alignItems: "flex-start" } }, h("input", { type: "checkbox", checked, disabled: !chat, onchange: async (event) => { const next = event.target.checked ? [...new Set([...(chat.repoIds.length ? chat.repoIds : repos.map((item) => item.id)), repo.id])] : (chat.repoIds.length ? chat.repoIds : repos.map((item) => item.id)).filter((id) => id !== repo.id); await put(`/api/chats/${chat.id}`, { repoIds: next }); chat.repoIds = next; toast("Repositorios de la conversación actualizados."); } }), h("span", {}, h("strong", { text: repo.name }), detected.includes(repo.name.toLowerCase()) ? h("span", { class: "chip chip--lime", style: { marginLeft: "6px" }, text: "detectado" }) : null, h("div", { class: "small muted mono", text: repo.path }))));
      }
      if (chat?.state?.repositories?.length) {
        const missing = chat.state.repositories.filter((name) => !repos.some((repo) => repo.name.toLowerCase() === name.toLowerCase()));
        if (missing.length) reposNode.append(h("div", { class: "callout callout--warn small", text: `El asistente necesita repositorios no registrados: ${missing.join(", ")}. Regístralos en el paso 2 (ruta local).` }));
      }
    }
    async function startChat() {
      const chat = await post("/api/chats", { kind: "work", sourceIds: [source.id], model: appState.model === "auto" ? "" : appState.model });
      await openChat(chat.id);
    }
    async function openChat(id) {
      view?.destroy();
      clear(chatHost);
      view = createChatView({ chatId: id, showPhase: true, placeholder: "Describe el cambio que necesitas en lenguaje de negocio…", onState: (chat) => { view.setPhase(); renderPackage(chat); renderRepos(chat); } });
      chatHost.append(h("div", { class: "card" }, view.root));
      await view.load();
      refreshList(id);
    }
    function renderPackage(chat) {
      clear(packageHost);
      packageHost.append(renderPackagePanel({ chatId: chat.id, pkg: chat.state?.package, layers, onChanged: async (result) => { await view.refresh(); refreshSources(); refreshList(chat.id); if (result) toast("Ve a Ejecución para lanzar las tareas sobre los repositorios.", "ok", 6000); } }));
    }
    await refreshList();
    await renderRepos(null);
    packageHost.append(renderPackagePanel({ chatId: "", pkg: null, layers }));
    return () => view?.destroy();
  }

  /* ---------- Ejecución ---------- */
  async function renderExecution(node, openRunId) {
    const treeNode = h("div", { class: "list" });
    const runsNode = h("div", { class: "list" });
    const detailNode = h("div");
    let unsubscribe = null;
    node.append(h("div", { class: "bento", style: { gridTemplateColumns: "320px minmax(0, 1fr)", alignItems: "start" } },
      h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } }, h("div", { class: "card" }, h("p", { class: "ante-title", text: "Iniciativas persistidas" }), treeNode), h("div", { class: "card" }, h("p", { class: "ante-title", text: "Ejecuciones" }), runsNode)),
      detailNode));
    async function refreshTree() {
      const data = await get(`/api/sources/${source.id}/work`);
      clear(treeNode);
      if (!data.tree.length) treeNode.append(h("div", { class: "muted small", text: "No hay iniciativas Work en la base de conocimiento. Créalas en el paso 1." }));
      for (const spec of data.tree) {
        const tasks = spec.plans.flatMap((plan) => plan.tasks);
        treeNode.append(h("div", { class: "list-item", style: { flexDirection: "column", alignItems: "stretch" } },
          h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px" } }, h("div", { class: "list-item__main" }, h("div", { class: "list-item__title" }, h("span", { class: "mono", text: spec.id })), h("div", { class: "small", text: spec.title }), h("div", { class: "list-item__meta", text: `${spec.plans.length} plan(es) · ${tasks.length} tarea(s)` })), statusChip(spec.status)),
          h("button", { class: "btn btn--sm", style: { marginTop: "8px" }, text: "Preparar ejecución", disabled: !tasks.length, onclick: () => prepareRun(spec) })));
      }
    }
    async function refreshRuns() {
      const data = await get(`/api/runs?sourceId=${source.id}`);
      clear(runsNode);
      if (!data.runs.length) runsNode.append(h("div", { class: "muted small", text: "Sin ejecuciones." }));
      for (const run of data.runs) runsNode.append(h("div", { class: `list-item is-clickable${run.id === openRunId ? " is-active" : ""}`, onclick: () => openRun(run.id) }, h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: run.title }), h("div", { class: "list-item__meta", text: `${run.workSpecId} · ${run.tasks.filter((task) => task.status === "committed").length}/${run.tasks.length} confirmadas · ${fmtDate(run.updatedAt)}` })), statusChip(run.status)));
    }
    async function prepareRun(spec) {
      const repos = await loadRepos();
      if (!repos.length) { toast("Registra primero los repositorios (paso 2).", "error"); return; }
      const { close } = openModal([], { wide: true });
      const tasks = spec.plans.flatMap((plan) => plan.tasks.map((task) => ({ ...task, planId: plan.id })));
      const selects = new Map();
      const branch = h("input", { class: "input", value: "", placeholder: "Se generará a partir de la iniciativa" });
      document.querySelector(".modal").append(
        modalHeader(spec.title, close, `Preparar ejecución · ${spec.id}`),
        h("p", { class: "muted small", text: "Asigna a cada tarea el repositorio sobre el que se ejecutará. Doriath crea una rama por iniciativa y ejecuta cada tarea con Copilot; después revisas el diff y confirmas el commit." }),
        h("div", { class: "field" }, h("label", { text: "Rama de trabajo (opcional)" }), branch),
        h("table", { class: "table table--compact" }, h("thead", {}, h("tr", {}, h("th", {}), h("th", { text: "Tarea" }), h("th", { text: "Tipo" }), h("th", { text: "Repositorio" }))), h("tbody", {}, tasks.map((task) => {
          const select = h("select", { class: "select" }, h("option", { value: "", text: "— sin repositorio —" }), repos.map((repo) => h("option", { value: repo.id, text: repo.name, selected: task.repositoryHint && repo.name.toLowerCase() === task.repositoryHint.toLowerCase() })));
          const check = h("input", { type: "checkbox", checked: true });
          selects.set(task.id, { select, check });
          return h("tr", {}, h("td", {}, check), h("td", {}, h("div", { class: "mono", text: task.id }), h("div", { class: "small", text: task.title })), h("td", {}, h("span", { class: "chip chip--outline", text: task.task_kind || "implementation" })), h("td", {}, select));
        }))),
        h("div", { class: "card__actions", style: { justifyContent: "flex-end" } }, h("button", { class: "btn btn--lime", text: "Crear ejecución", onclick: async () => {
          const taskIds = tasks.filter((task) => selects.get(task.id).check.checked).map((task) => task.id);
          const assignments = taskIds.map((taskId) => ({ taskId, repositoryId: selects.get(taskId).select.value }));
          try {
            const run = await post("/api/runs", { sourceId: source.id, workSpecId: spec.id, taskIds, assignments, branch: branch.value.trim() || undefined, model: appState.model === "auto" ? "" : appState.model });
            close();
            await refreshRuns();
            openRun(run.id);
          } catch (error) {
            toast(error.message, "error");
          }
        } })));
    }
    async function openRun(runId) {
      openRunId = runId;
      unsubscribe?.();
      refreshRuns();
      let run = await get(`/api/runs/${runId}`);
      const render = () => renderRun(detailNode, run, { refresh: async () => { run = await get(`/api/runs/${runId}`); render(); refreshRuns(); } });
      render();
      unsubscribe = subscribe(`run:${runId}`, async (event) => {
        if (event.type === "log") {
          const log = detailNode.querySelector(`[data-log="${event.data.taskId || "run"}"]`);
          if (log) { log.append(h("div", { class: "log__line" }, h("span", { class: "log__time", text: new Date(event.at).toLocaleTimeString("es-ES") }), event.data.message)); log.scrollTop = log.scrollHeight; }
        } else if (event.type === "delta") {
          const stream = detailNode.querySelector(`[data-stream="${event.data.taskId}"]`);
          if (stream) { stream.textContent += event.data.text; stream.scrollTop = stream.scrollHeight; }
        } else if (event.type === "task") {
          run = await get(`/api/runs/${runId}`);
          render();
          refreshRuns();
        }
      });
    }
    function renderRun(host, run, { refresh }) {
      clear(host);
      const card = h("div", { class: "card" });
      host.append(card);
      card.append(h("div", { class: "card__header" }, h("div", {}, h("p", { class: "ante-title", text: `Ejecución · ${run.workSpecId}` }), h("h2", { text: run.title }), h("div", { class: "chips", style: { marginTop: "8px" } }, statusChip(run.status), h("span", { class: "chip chip--serene", text: run.branch }))), h("div", { class: "card__actions" }, h("button", { class: "btn btn--outline btn--sm", text: "Cambiar rama", onclick: async () => { const value = await promptDialog("Rama de trabajo", { label: "Rama", value: run.branch }); if (value) { await put(`/api/runs/${run.id}`, { branch: value }); refresh(); } } }))));
      // Repositorios y acciones globales
      const repoActions = h("div", { class: "list", style: { margin: "12px 0" } });
      for (const repo of run.repositories.filter((item) => run.tasks.some((task) => task.repositoryId === item.id))) {
        repoActions.append(h("div", { class: "list-item" }, h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: repo.name }), h("div", { class: "list-item__meta mono", text: repo.path })),
          h("div", { class: "card__actions" },
            h("button", { class: "btn btn--outline btn--xs", text: "Tests", onclick: () => runCommand(run, repo, "test") }),
            h("button", { class: "btn btn--outline btn--xs", text: "Build", onclick: () => runCommand(run, repo, "build") }),
            h("button", { class: "btn btn--outline btn--xs", text: "Push", onclick: async () => { try { await post(`/api/runs/${run.id}/push`, { repositoryId: repo.id }); toast(`Push realizado en ${repo.name}`, "ok"); refresh(); } catch (error) { toast(error.message, "error", 7000); } } }),
            h("button", { class: "btn btn--accent btn--xs", text: "Pull request", onclick: async () => { const title = await promptDialog("Crear pull request", { label: "Título", value: `${run.workSpecId}: ${run.title}` }); if (!title) return; try { const result = await post(`/api/runs/${run.id}/pull-request`, { repositoryId: repo.id, title }); toast(`Pull request creada: ${result.url}`, "ok", 8000); refresh(); } catch (error) { toast(error.message, "error", 7000); } } }))));
      }
      card.append(h("p", { class: "ante-title", text: "Repositorios" }), repoActions);
      if (run.pullRequests?.length) card.append(h("div", { class: "callout callout--ok small", html: run.pullRequests.map((pr) => `Pull request: <a href="${pr.url}" target="_blank" rel="noopener">${pr.url}</a>`).join("<br>") }));
      // Tareas
      card.append(h("p", { class: "ante-title", style: { marginTop: "16px" }, text: "Tareas" }));
      for (const task of run.tasks) {
        const repo = run.repositories.find((item) => item.id === task.repositoryId);
        const taskCard = h("div", { class: "card card--sand", style: { marginBottom: "12px" } });
        const repoSelect = h("select", { class: "select", style: { maxWidth: "260px" }, disabled: task.status === "running", onchange: async (event) => { await put(`/api/runs/${run.id}`, { assignments: [{ taskId: task.id, repositoryId: event.target.value }] }); refresh(); } }, h("option", { value: "", text: "— repositorio —" }), run.repositories.map((item) => h("option", { value: item.id, text: item.name, selected: item.id === task.repositoryId })));
        taskCard.append(h("div", { class: "card__header" },
          h("div", {}, h("div", { class: "chips", style: { marginBottom: "6px" } }, h("span", { class: "mono", text: task.id }), statusChip(task.status), h("span", { class: "chip chip--outline", text: task.taskKind })), h("h3", { text: task.title })),
          h("div", { class: "card__actions" }, repoSelect,
            task.status === "running"
              ? h("button", { class: "btn btn--danger btn--sm", text: "Cancelar", onclick: () => post(`/api/runs/${run.id}/tasks/${task.id}/cancel`) })
              : h("button", { class: "btn btn--sm", text: task.attempts ? "Volver a ejecutar" : "Ejecutar", disabled: !task.repositoryId || task.status === "committed", onclick: async () => { try { await post(`/api/runs/${run.id}/tasks/${task.id}/execute`); refresh(); } catch (error) { toast(error.message, "error"); } } }))));
        if (task.status === "running") {
          taskCard.append(h("div", { class: "log", dataset: { log: task.id } }, (task.log || []).slice(-40).map((entry) => h("div", { class: "log__line" }, h("span", { class: "log__time", text: new Date(entry.at).toLocaleTimeString("es-ES") }), entry.message))), h("pre", { class: "code small", dataset: { stream: task.id }, style: { marginTop: "8px", maxHeight: "200px", whiteSpace: "pre-wrap" } }));
        } else if (task.status === "review" || task.status === "no-changes" || task.status === "failed" || task.status === "committed" || task.status === "cancelled") {
          if (task.error) taskCard.append(h("div", { class: "callout callout--error small", text: task.error }));
          if (task.summary) taskCard.append(h("details", { open: task.status === "review" }, h("summary", { class: "small muted", text: "Informe del agente" }), md(task.summary)));
          if (task.commit) taskCard.append(h("div", { class: "callout callout--ok small", text: `Commit ${task.commit.sha}: ${task.commit.message}` }));
          if (task.status === "review") {
            const message = h("input", { class: "input", value: `feat(${task.id}): ${task.title}` });
            taskCard.append(
              h("p", { class: "small muted", style: { margin: "8px 0" }, text: `${task.files.length} fichero(s) modificado(s) en ${repo?.name || ""}: ${task.files.map((file) => file.path).join(", ")}` }),
              h("details", {}, h("summary", { class: "small muted", text: "Ver diff" }), renderDiff(task.diff)),
              h("div", { class: "form-row", style: { marginTop: "12px" } }, h("div", { class: "field", style: { flex: 2 } }, h("label", { text: "Mensaje de commit" }), message),
                h("button", { class: "btn btn--lime", text: "Confirmar commit", onclick: async () => { try { await post(`/api/runs/${run.id}/tasks/${task.id}/commit`, { message: message.value }); toast("Commit realizado", "ok"); refresh(); } catch (error) { toast(error.message, "error", 7000); } } }),
                h("button", { class: "btn btn--outline", text: "Actualizar diff", onclick: async () => { await get(`/api/runs/${run.id}/tasks/${task.id}/diff`); refresh(); } }),
                h("button", { class: "btn btn--danger", text: "Descartar cambios", onclick: async () => { if (await confirmDialog("Descartar cambios", "Se revierten los cambios sin confirmar del repositorio.", { okLabel: "Descartar", danger: true })) { await post(`/api/runs/${run.id}/tasks/${task.id}/discard`); refresh(); } } })));
          }
          if (task.log?.length) taskCard.append(h("details", {}, h("summary", { class: "small muted", text: "Registro" }), h("div", { class: "log", dataset: { log: task.id } }, task.log.map((entry) => h("div", { class: "log__line" }, h("span", { class: "log__time", text: new Date(entry.at).toLocaleTimeString("es-ES") }), entry.message)))));
        }
        card.append(taskCard);
      }
      card.append(h("details", {}, h("summary", { class: "small muted", text: "Registro de la ejecución" }), h("div", { class: "log", dataset: { log: "run" } }, (run.log || []).map((entry) => h("div", { class: "log__line" }, h("span", { class: "log__time", text: new Date(entry.at).toLocaleTimeString("es-ES") }), entry.message)))));
    }
    async function runCommand(run, repo, kind) {
      toast(`Ejecutando ${kind} en ${repo.name}…`);
      try {
        const result = await post(`/api/runs/${run.id}/command`, { repositoryId: repo.id, kind });
        const { close } = openModal([], { wide: true });
        document.querySelector(".modal").append(modalHeader(`${kind} · ${repo.name}`, close, result.skipped ? "Sin comando detectado" : result.ok ? "Terminó correctamente" : `Terminó con código ${result.code}`), h("pre", { class: "code", text: result.output || "(sin salida)" }));
      } catch (error) {
        toast(error.message, "error", 7000);
      }
    }
    await refreshTree();
    await refreshRuns();
    if (openRunId) openRun(openRunId);
    else detailNode.append(h("div", { class: "card card--serene" }, h("p", { class: "ante-title", text: "Paso 3" }), h("h3", { text: "Ejecutar las tareas" }), h("p", { class: "small", style: { marginTop: "8px" }, text: "Elige una iniciativa persistida, asigna repositorio a cada tarea y ejecútalas una a una. Cada tarea termina con un diff que revisas antes de confirmar el commit; después puedes hacer push y abrir una pull request." })));
    return () => unsubscribe?.();
  }

  renderTabs();
  await selectTab(tab, params[1]);
  return { destroy: () => cleanup?.() };
}
