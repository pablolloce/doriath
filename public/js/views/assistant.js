/** BBVA CIB Assistant: conversaciones con contexto de todas las bases de conocimiento y entregables. */
import { get, post, put, del } from "../api.js";
import { h, clear, toast, confirmDialog, fmtDate, fmtBytes, promptDialog } from "../ui.js";
import { createChatView } from "../chat.js";
import { setBreadcrumb, navigate, state as appState } from "../app.js";

export async function renderAssistant({ container, params, state }) {
  setBreadcrumb("BBVA CIB Assistant");
  const listNode = h("div", { class: "list" });
  const chatHost = h("div");
  const filesNode = h("div", { class: "files-panel" });
  const scopeNode = h("div", { class: "list" });
  let view = null;
  let current = params[0] || localStorage.getItem("kdd.assistantChat") || "";

  const aside = h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
    h("div", { class: "card" },
      h("div", { class: "card__header", style: { marginBottom: "12px", alignItems: "center" } },
        h("p", { class: "ante-title", style: { marginBottom: 0 }, text: "Conversaciones" }),
        h("button", { class: "btn btn--outline btn--xs", text: "+ Nueva", onclick: () => createConversation() })),
      listNode),
  );
  const rightPanel = h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
    h("div", { class: "card" }, h("p", { class: "ante-title", text: "Bases de conocimiento en contexto" }), scopeNode),
    h("div", { class: "card" }, h("div", { class: "card__header" }, h("p", { class: "ante-title", text: "Ficheros generados" }), h("button", { class: "btn btn--ghost btn--xs", text: "Abrir carpeta", onclick: async () => { const data = await get("/api/outputs"); post("/api/open", { path: data.root }).catch((error) => toast(error.message, "error")); } })), filesNode),
  );
  container.append(h("div", { class: "bento", style: { gridTemplateColumns: "280px minmax(0, 1fr) 300px", alignItems: "start" } }, aside, chatHost, rightPanel));

  async function createConversation() {
    try {
      const chat = await post("/api/chats", { kind: "assistant", model: appState.model === "auto" ? "" : appState.model });
      current = chat.id;
      await refreshList();
      await openConversation(chat.id);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function refreshList() {
    const data = await get("/api/chats?kind=assistant");
    clear(listNode);
    if (!data.chats.length) listNode.append(h("div", { class: "empty small", text: "Sin conversaciones todavía." }));
    for (const chat of data.chats) {
      listNode.append(h("div", { class: `list-item is-clickable${chat.id === current ? " is-active" : ""}`, onclick: () => openConversation(chat.id) },
        h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: chat.title }), h("div", { class: "list-item__meta", text: `${chat.messages} mensajes · ${fmtDate(chat.updatedAt)}` })),
        h("button", { class: "btn btn--ghost btn--xs", text: "×", title: "Eliminar", onclick: async (event) => { event.stopPropagation(); if (await confirmDialog("Eliminar conversación", `Se eliminará "${chat.title}".`, { okLabel: "Eliminar", danger: true })) { await del(`/api/chats/${chat.id}`); if (current === chat.id) { current = ""; clear(chatHost); } await refreshList(); } } })));
    }
  }

  function renderScope(chat) {
    clear(scopeNode);
    for (const source of state.sources.filter((item) => item.exists)) {
      const checked = chat.sourceIds.includes(source.id);
      scopeNode.append(h("label", { class: "checkbox" }, h("input", { type: "checkbox", checked, onchange: async (event) => {
        const next = event.target.checked ? [...new Set([...chat.sourceIds, source.id])] : chat.sourceIds.filter((id) => id !== source.id);
        await put(`/api/chats/${chat.id}`, { sourceIds: next });
        chat.sourceIds = next;
        toast("Contexto actualizado; se aplicará en el siguiente mensaje.");
      } }), `${source.name} (${source.sourceId})`));
    }
    if (!scopeNode.children.length) scopeNode.append(h("div", { class: "muted small", text: "No hay bases de conocimiento registradas." }));
  }

  function renderFiles(chat) {
    clear(filesNode);
    const files = chat.state?.files || [];
    if (!files.length) filesNode.append(h("div", { class: "muted small", text: "Los ficheros que genere el asistente aparecerán aquí." }));
    for (const file of [...files].reverse()) {
      filesNode.append(h("div", { class: "file-card" },
        h("div", { style: { minWidth: 0 } }, h("div", { class: "file-card__name", text: file.name }), h("div", { class: "muted small", text: `${fmtBytes(file.size)} · ${fmtDate(file.at)}` })),
        h("a", { class: "btn btn--outline btn--xs", href: file.url, text: "Descargar" })));
    }
  }

  async function openConversation(id, { silentIfMissing = false } = {}) {
    current = id;
    localStorage.setItem("kdd.assistantChat", id);
    view?.destroy();
    clear(chatHost);
    view = createChatView({
      chatId: id,
      placeholder: "Pregunta sobre el conocimiento o pide un entregable (informe, presentación, hoja, código)…",
      onState: (chat) => { renderFiles(chat); },
      onFile: (file) => { view.chat.state.files = [...(view.chat.state.files || []), file]; renderFiles(view.chat); },
    });
    const header = h("div", { class: "card__header" },
      h("div", {}, h("p", { class: "ante-title", text: "Conversación" }), h("h2", { id: "chatTitle" })),
      h("div", { class: "card__actions" },
        h("button", { class: "btn btn--outline btn--xs", text: "Renombrar", onclick: async () => { const title = await promptDialog("Renombrar", { label: "Título", value: view.chat.title }); if (title) { await put(`/api/chats/${id}`, { title }); view.chat.title = title; header.querySelector("#chatTitle").textContent = title; refreshList(); } } })));
    chatHost.append(h("div", { class: "card card--chat" }, header, view.root));
    try {
      const chat = await view.load();
      header.querySelector("#chatTitle").textContent = chat.title;
      renderScope(chat);
      renderFiles(chat);
      await refreshList();
    } catch (error) {
      current = "";
      localStorage.removeItem("kdd.assistantChat");
      clear(chatHost);
      // 404 al restaurar la última conversación abierta (se borró, o viene de otra instalación): no es un
      // fallo que el usuario haya provocado, así que se resuelve en silencio en vez de enseñar el error técnico.
      if (error.status === 404 && silentIfMissing) chatHost.append(emptyState());
      else toast(error.message, "error");
    }
  }

  function emptyState() {
    return h("div", { class: "card card--serene" }, h("p", { class: "ante-title", text: "Empieza" }), h("h2", { text: "Crea una conversación" }), h("p", { class: "lead", style: { marginTop: "8px" }, text: "El asistente responde con el conocimiento de las bases seleccionadas y puede producir documentos Word, presentaciones, hojas Excel, informes HTML o ficheros de código, todos con la identidad BBVA." }), h("div", { class: "card__actions", style: { marginTop: "16px" } }, h("button", { class: "btn", text: "Nueva conversación", onclick: createConversation })));
  }

  await refreshList();
  if (current) await openConversation(current, { silentIfMissing: !params[0] });
  else chatHost.append(emptyState());

  return { destroy: () => view?.destroy() };
}
