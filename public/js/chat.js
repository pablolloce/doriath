/**
 * Componente de conversación reutilizable (asistente, creación Work, creación de specs, resolución).
 * Renderiza el hilo, gestiona adjuntos, streaming por SSE y expone hooks para paquetes/acciones.
 */
import { get, post, subscribe, readFileAsBase64 } from "./api.js";
import { h, md, toast, fmtDate, fmtBytes, autoResize, clear } from "./ui.js";

const PHASES = ["understand", "classify", "validate", "generate"];
const PHASE_LABELS = { understand: "Entender", classify: "Clasificar", validate: "Validar", generate: "Generar" };

export function phaseBar(phase) {
  const index = PHASES.indexOf(phase);
  return h("div", { class: "phase" }, PHASES.map((step, position) => h("div", { class: `phase__step${position < index ? " is-done" : position === index ? " is-current" : ""}`, text: PHASE_LABELS[step] })));
}

export function createChatView({ chatId, placeholder = "Escribe tu mensaje…", onState, onFile, onMessage, decorateMessage, showPhase = false, allowAttachments = true, plain = false }) {
  const thread = h("div", { class: "chat__thread" });
  const composerText = h("textarea", { placeholder, rows: 2, oninput: (event) => autoResize(event.target) });
  const fileInput = h("input", { type: "file", multiple: true, hidden: true });
  const filesRow = h("div", { class: "composer__files" });
  const sendButton = h("button", { class: "btn", text: "Enviar" });
  const abortButton = h("button", { class: "btn btn--outline btn--sm", text: "Detener", hidden: true });
  const status = h("span", { class: "muted small" });
  const header = h("div", { class: "chat__header" });
  const composer = h("div", { class: "composer" },
    composerText,
    filesRow,
    h("div", { class: "composer__bar" },
      h("div", { class: "card__actions" },
        allowAttachments ? h("button", { class: "btn btn--outline btn--sm", text: "Adjuntar", onclick: () => fileInput.click() }) : null,
        abortButton,
        status),
      sendButton));
  const root = h("div", { class: "chat" }, header, thread, composer, fileInput);

  let chat = null;
  let pending = [];
  let streamingNode = null;
  let streamingText = "";
  let toolsNode = null;
  let unsubscribe = null;

  function setBusy(busy) {
    sendButton.disabled = busy;
    abortButton.hidden = !busy;
    status.textContent = busy ? "El asistente está trabajando…" : "";
  }

  function renderMessage(message) {
    const node = h("div", { class: `msg msg--${message.role}${message.error ? " msg--error" : ""}` },
      h("div", { class: "msg__meta" }, h("span", { text: message.role === "user" ? "Tú" : "Doriath" }), h("span", { text: fmtDate(message.at) }), message.model ? h("span", { text: message.model }) : null),
    );
    if (message.error) node.append(h("p", { text: `Error: ${message.error}` }));
    else if (message.role === "user") node.append(h("div", { class: "md", text: message.content }));
    else node.append(md(message.content || "(sin contenido)"));
    if (message.attachments?.length) node.append(h("div", { class: "msg__attachments" }, message.attachments.map((file) => h("span", { class: "file-chip", text: `${file.name} · ${fmtBytes(file.size)}` }))));
    if (message.packageId) node.append(h("div", { class: "callout callout--info", style: { marginTop: "10px" }, text: plain ? "Doriath ha preparado una propuesta. Revísala en el panel de la derecha y guárdala cuando te encaje." : "Se ha propuesto un paquete de specs. Revísalo en el panel de la derecha y confirma para persistirlo." }));
    if (message.actionError) node.append(h("div", { class: "callout callout--warn", style: { marginTop: "10px" }, text: `El bloque de acciones no se pudo interpretar: ${message.actionError}` }));
    if (message.applied?.length) node.append(h("div", { class: "callout callout--ok", style: { marginTop: "10px" }, text: `Acciones aplicadas al preview: ${message.applied.map((item) => `${item.type} ${item.id}`).join(", ")}.` }));
    // Gancho para que una vista añada acciones bajo el mensaje (por ejemplo, corregir una respuesta).
    decorateMessage?.(message, node, chat);
    return node;
  }

  function renderThread() {
    clear(thread);
    if (!chat.messages.length) {
      thread.append(h("div", { class: "empty", text: chat.kind === "assistant" ? "Pregunta por el conocimiento de las bases disponibles o pide un entregable (informe, presentación, hoja de cálculo, código)." : "Describe en lenguaje de negocio qué quieres conseguir. El asistente preguntará lo que necesite." }));
    }
    for (const message of chat.messages) thread.append(renderMessage(message));
    thread.scrollTop = thread.scrollHeight;
  }

  function ensureStreamingNode() {
    if (streamingNode) return streamingNode;
    toolsNode = h("div", { class: "msg__tools" });
    streamingNode = h("div", { class: "msg msg--assistant" }, h("div", { class: "msg__meta" }, h("span", { text: "Doriath" }), h("span", { class: "typing" }, h("span"), h("span"), h("span"))), toolsNode, h("div", { class: "md" }));
    thread.append(streamingNode);
    return streamingNode;
  }

  function handleEvent(event) {
    const data = event.data || {};
    if (event.type === "delta") {
      const node = ensureStreamingNode();
      streamingText += data.text || "";
      node.querySelector(".md").textContent = streamingText;
      thread.scrollTop = thread.scrollHeight;
    } else if (event.type === "tool") {
      const node = ensureStreamingNode();
      const chip = h("span", { class: "tool-chip is-running", text: `${data.name}${data.target ? ` · ${data.target}` : ""}`, dataset: { id: data.id || "" } });
      node.querySelector(".msg__tools").append(chip);
    } else if (event.type === "tool_done") {
      const chip = streamingNode?.querySelector(`.tool-chip[data-id="${data.id}"]`);
      if (chip) chip.className = `tool-chip${data.success ? "" : " is-failed"}`;
    } else if (event.type === "turn_start") {
      streamingText = "";
    } else if (event.type === "file") {
      onFile?.(data);
      toast(`Fichero generado: ${data.name}`, "ok");
    } else if (event.type === "assistant") {
      streamingNode?.remove();
      streamingNode = null;
      streamingText = "";
      chat.messages.push(data.message);
      chat.state = data.state || chat.state;
      chat.busy = false;
      thread.append(renderMessage(data.message));
      thread.scrollTop = thread.scrollHeight;
      setBusy(false);
      onState?.(chat);
      onMessage?.(data.message, chat);
    } else if (event.type === "package-persisted") {
      onState?.(chat);
    } else if (event.type === "error") {
      toast(data.message || "Error en la sesión", "error");
    }
  }

  async function load() {
    chat = await get(`/api/chats/${chatId}`);
    renderThread();
    renderHeader();
    setBusy(Boolean(chat.busy));
    unsubscribe?.();
    unsubscribe = subscribe(`chat:${chat.id}`, handleEvent);
    onState?.(chat);
    return chat;
  }

  function renderHeader() {
    clear(header);
    if (showPhase) header.append(phaseBar(chat.state?.phase || ""));
  }

  fileInput.addEventListener("change", () => {
    for (const file of fileInput.files) pending.push(file);
    fileInput.value = "";
    renderPending();
  });

  function renderPending() {
    clear(filesRow);
    pending.forEach((file, index) => filesRow.append(h("span", { class: "file-chip" }, `${file.name} · ${fmtBytes(file.size)}`, h("button", { text: "×", onclick: () => { pending.splice(index, 1); renderPending(); } }))));
  }

  async function send() {
    const text = composerText.value.trim();
    if (!text && !pending.length) return;
    setBusy(true);
    const attachments = [];
    for (const file of pending) attachments.push({ name: file.name, base64: await readFileAsBase64(file) });
    pending = [];
    renderPending();
    composerText.value = "";
    autoResize(composerText);
    const optimistic = { role: "user", content: text, at: new Date().toISOString(), attachments: attachments.map((item) => ({ name: item.name, size: 0 })) };
    chat.messages.push(optimistic);
    thread.append(renderMessage(optimistic));
    thread.scrollTop = thread.scrollHeight;
    try {
      await post(`/api/chats/${chatId}/messages`, { text, attachments });
    } catch (error) {
      toast(error.message, "error");
      setBusy(false);
      streamingNode?.remove();
      streamingNode = null;
      await load();
    }
  }

  sendButton.addEventListener("click", send);
  composerText.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  abortButton.addEventListener("click", async () => {
    try {
      await post(`/api/chats/${chatId}/abort`);
      toast("Se ha pedido detener la respuesta.");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  return { root, load, destroy: () => unsubscribe?.(), get chat() { return chat; }, renderThread, refresh: load, setPhase: renderHeader };
}
