/**
 * My Knowledge Bases — la cara para quien aporta conocimiento pero no lo mantiene.
 *
 * Aquí no se nombra ni una vez una spec, ni una capa, ni un identificador: se suben documentos,
 * Doriath "aprende" de ellos y se le pregunta. Si una respuesta no encaja, se corrige desde el propio
 * chat y la corrección queda firmada en el registro que ve el administrador.
 */
import { get, post, subscribe, readFileAsBase64 } from "../api.js";
import { h, clear, toast, fmtBytes } from "../ui.js";
import { createChatView } from "../chat.js";
import { setBreadcrumb, activeSource, refreshSources, openSourcesManager, kbPicker, state as appState } from "../app.js";

export async function renderMyKnowledge({ container }) {
  const source = activeSource();
  setBreadcrumb("My Knowledge Bases", source?.name);
  container.append(kbPicker({}));
  if (!source) {
    container.append(h("div", { class: "card card--electric" },
      h("p", { class: "ante-title", text: "Mis bases de conocimiento" }),
      h("h1", { text: "Empieza creando una" }),
      h("p", { class: "lead", style: { marginTop: "12px" }, text: "Una base de conocimiento es, sencillamente, todo lo que Doriath sabe sobre un tema tuyo: sus documentos y lo que ha aprendido de ellos." }),
      h("div", { class: "card__actions", style: { marginTop: "20px" } }, h("button", { class: "btn btn--accent", text: "Crear una base de conocimiento", onclick: openSourcesManager }))));
    return {};
  }

  const heroChips = h("div", { class: "chips", style: { marginTop: "18px" } });
  const documentsNode = h("div", { class: "list" });
  const learnedNode = h("div", {});
  const resultNode = h("div", {});
  const chatHost = h("div", {});
  const selected = new Set();
  let knowledge = { knows: [], documents: [], total: 0 };
  let unsubscribe = null;

  const learnButton = h("button", { class: "btn btn--lime", text: "Aprender de estos documentos", disabled: true, onclick: () => learn([...selected]) });
  const fileInput = h("input", { type: "file", multiple: true, hidden: true, onchange: (event) => upload([...event.target.files]) });

  container.append(
    h("div", { class: "card card--electric" },
      h("div", { class: "card__header" },
        h("div", {},
          h("p", { class: "ante-title", text: "Tu base de conocimiento" }),
          h("h1", { text: source.name }),
          h("p", { class: "lead", style: { marginTop: "10px", opacity: 0.9 }, text: "Sube los documentos de tu equipo y Doriath los lee y aprende de ellos. Después pregúntale lo que necesites; si una respuesta no te encaja, se lo dices y lo corrige." })),
        h("div", { class: "card__actions" }, h("button", { class: "btn btn--accent btn--sm", text: "Nueva base", onclick: openSourcesManager }))),
      heroChips),
    h("div", { class: "bento bento--main-aside" }, documentsCard(), howItWorksCard()),
    resultNode,
    h("div", { class: "bento bento--main-aside" }, chatHost, h("div", { class: "card" }, h("p", { class: "ante-title", text: "Lo que Doriath sabe" }), learnedNode)),
    fileInput,
  );

  await loadKnowledge();
  await mountChat();

  return { destroy: () => unsubscribe?.() };

  /* ---------- Datos ---------- */
  async function loadKnowledge() {
    try {
      knowledge = await get(`/api/sources/${source.id}/knowledge`);
    } catch (error) {
      toast(error.message, "error");
      knowledge = { knows: [], documents: [], total: 0 };
    }
    renderHero();
    renderDocuments();
    renderLearned();
  }

  function renderHero() {
    clear(heroChips);
    heroChips.append(
      h("span", { class: "chip chip--serene", text: `${knowledge.documents.length} documento${knowledge.documents.length === 1 ? "" : "s"}` }),
      h("span", { class: "chip chip--lime", text: `${knowledge.total} cosas aprendidas` }),
      knowledge.total ? h("span", { class: "chip chip--ice", text: "Lista para preguntar" }) : h("span", { class: "chip chip--canary", text: "Aún no ha aprendido nada" }));
  }

  /* ---------- Documentos ---------- */
  function documentsCard() {
    const dropzone = h("div", { class: "dropzone", onclick: () => fileInput.click() },
      h("p", { style: { fontWeight: 700, marginBottom: "4px" }, text: "Arrastra aquí tus documentos" }),
      h("p", { class: "small muted", text: "o pulsa para elegirlos en tu equipo" }));
    dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("is-over"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-over"));
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-over");
      upload([...event.dataTransfer.files]);
    });
    return h("div", { class: "card" },
      h("div", { class: "card__header" },
        h("div", {}, h("p", { class: "ante-title", text: "Paso 1" }), h("h2", { text: "Sube tus documentos" })),
        h("span", { class: "chip chip--outline", text: "PDF · Word · PowerPoint · Excel" })),
      dropzone,
      h("div", { style: { marginTop: "16px" } }, documentsNode),
      h("div", { class: "card__actions", style: { marginTop: "16px" } }, learnButton, h("span", { class: "small muted", text: "Marca los que quieras que lea." })));
  }

  function renderDocuments() {
    clear(documentsNode);
    if (!knowledge.documents.length) {
      documentsNode.append(h("div", { class: "empty small", text: "Todavía no hay documentos. Sube el primero ahí arriba." }));
      return;
    }
    for (const document of knowledge.documents) {
      const checkbox = h("input", {
        type: "checkbox",
        checked: selected.has(document.name),
        onchange: () => {
          if (selected.has(document.name)) selected.delete(document.name); else selected.add(document.name);
          learnButton.disabled = !selected.size;
          renderDocuments();
        },
      });
      documentsNode.append(h("label", { class: `list-item${selected.has(document.name) ? " is-active" : ""}`, style: { cursor: "pointer" } },
        h("span", { class: "list-item__main" },
          h("span", { class: "list-item__title", text: document.name }),
          h("span", { class: "list-item__meta", text: `${fmtBytes(document.size)}${document.importedBy ? ` · lo subió ${document.importedBy}` : ""}` })),
        h("span", { style: { display: "flex", alignItems: "center", gap: "10px" } },
          document.analyzed ? h("span", { class: "chip chip--lime", text: "Aprendido" }) : h("span", { class: "chip", text: "Sin aprender" }),
          checkbox)));
    }
  }

  async function upload(files) {
    const valid = files.filter(Boolean);
    if (!valid.length) return;
    toast(`Subiendo ${valid.length} documento(s)…`);
    try {
      const payload = [];
      for (const file of valid) payload.push({ name: file.name, base64: await readFileAsBase64(file) });
      await post(`/api/sources/${source.id}/documents`, { files: payload });
      await loadKnowledge();
      await refreshSources().catch(() => undefined);
      toast("Documentos subidos", "ok");
    } catch (error) {
      toast(error.message, "error");
    }
    fileInput.value = "";
  }

  /* ---------- Aprender (análisis, contado sin jerga) ---------- */
  async function learn(names) {
    clear(resultNode);
    const progress = h("div", { class: "progress" }, h("div", { class: "progress__bar is-busy" }));
    const stepText = h("p", { class: "small", style: { marginTop: "10px" }, text: "Abriendo los documentos…" });
    const card = h("div", { class: "card card--serene" },
      h("p", { class: "ante-title", text: "Aprendiendo" }),
      h("h3", { text: names.join(", ") }),
      h("div", { style: { marginTop: "14px" } }, progress),
      stepText);
    resultNode.append(card);
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    learnButton.disabled = true;

    // Los mensajes técnicos del analizador se traducen a lo que le importa a quien sube el documento.
    const PLAIN = {
      extracting: "Leyendo los documentos…",
      planning: "Ordenando lo que ha aprendido…",
      generating: "Redactando lo aprendido…",
      preview: "Comprobando que no se contradice con lo anterior…",
    };
    try {
      const job = await post(`/api/sources/${source.id}/analyze`, { documents: names });
      unsubscribe?.();
      unsubscribe = subscribe(`analysis:${job.id}`, async (event) => {
        const phase = event.data?.phase;
        if (phase && PLAIN[phase]) stepText.textContent = PLAIN[phase];
        if (event.type === "done") await finish(job.id, card, progress);
        if (event.type === "failed" || event.type === "cancelled") {
          clear(card);
          card.append(
            h("p", { class: "ante-title", text: "No ha podido" }),
            h("h3", { text: "Algo ha fallado leyendo los documentos" }),
            h("p", { class: "small", style: { marginTop: "8px" }, text: event.data?.error || "Vuelve a intentarlo." }));
          learnButton.disabled = false;
        }
      });
    } catch (error) {
      resultNode.replaceChildren(h("div", { class: "callout callout--error", text: error.message }));
      learnButton.disabled = false;
    }
  }

  async function finish(jobId, card, progress) {
    progress.firstChild?.classList.remove("is-busy");
    try {
      const job = await get(`/api/analyses/${jobId}`);
      const proposals = job.preview?.specs || [];
      const questions = [...(job.preview?.openQuestions || []), ...(job.preview?.conflicts || [])].filter((question) => !question.resolved);
      // El usuario no revisa specs: se confirma todo y se le cuenta en lenguaje llano.
      await post(`/api/analyses/${jobId}/confirm`, { specIds: proposals.map((spec) => spec.id) });
      const before = knowledge.total;
      await loadKnowledge();
      await refreshSources().catch(() => undefined);
      const nuevas = Math.max(knowledge.total - before, proposals.length);
      const aprendido = knowledge.knows.slice(0, Math.min(6, Math.max(1, proposals.length)));
      clear(resultNode);
      resultNode.append(h("div", { class: "card card--lime" },
        h("p", { class: "ante-title", text: "Listo" }),
        h("h2", { text: `He aprendido ${nuevas} cosa${nuevas === 1 ? "" : "s"} nueva${nuevas === 1 ? "" : "s"}` }),
        h("div", { style: { marginTop: "14px" } }, aprendido.map((item) => h("div", { class: "learned" }, h("span", { class: "learned__tick", text: "✓" }), h("span", { text: item.summary || item.title })))),
        h("p", { class: "small", style: { marginTop: "14px" }, text: "Ya puedes preguntarme sobre esto ahí abajo." })));
      if (questions.length) resultNode.append(questionsCard(jobId, questions));
      selected.clear();
      learnButton.disabled = true;
      renderDocuments();
      toast("Doriath ha aprendido de tus documentos", "ok");
    } catch (error) {
      resultNode.replaceChildren(h("div", { class: "callout callout--error", text: error.message }));
      learnButton.disabled = false;
    }
  }

  function questionsCard(jobId, questions) {
    const list = h("div", { class: "list" });
    for (const question of questions) {
      const answer = h("input", { class: "input", placeholder: "Escribe aquí la respuesta correcta…" });
      const row = h("div", { class: "list-item", style: { flexWrap: "wrap", background: "rgba(255,255,255,.55)" } },
        h("div", { class: "list-item__main", style: { width: "100%" } }, h("div", { style: { whiteSpace: "normal", fontWeight: 700 }, text: question.text })),
        h("div", { class: "form-row", style: { width: "100%", marginTop: "8px" } }, answer,
          h("button", { class: "btn btn--sm", text: "Responder", onclick: async () => {
            const value = answer.value.trim();
            if (!value) { toast("Escribe la respuesta primero.", "error"); return; }
            try {
              await post(`/api/analyses/${jobId}/questions/${encodeURIComponent(question.id)}`, { resolution: value, resolved: true }).catch(() => undefined);
              await post(`/api/sources/${source.id}/corrections`, { question: question.text, correction: value });
              clear(row);
              row.append(h("div", { class: "list-item__main" }, h("div", { class: "list-item__title", text: "Resuelta" }), h("div", { class: "list-item__meta", style: { whiteSpace: "normal" }, text: value })), h("span", { class: "chip chip--lime", text: "Aprendido" }));
              await loadKnowledge();
              toast("Gracias, lo he apuntado", "ok");
            } catch (error) {
              toast(error.message, "error");
            }
          } })));
      list.append(row);
    }
    return h("div", { class: "card card--canary", style: { marginTop: "16px" } },
      h("p", { class: "ante-title", text: "Necesito que me lo aclares" }),
      h("h3", { text: `Tengo ${questions.length} duda${questions.length === 1 ? "" : "s"}` }),
      h("p", { class: "small", style: { margin: "8px 0 14px" }, text: "Son cosas que los documentos dicen de dos maneras distintas. Con tu respuesta me quedo con la buena." }),
      list);
  }

  /* ---------- Lo que sabe ---------- */
  function renderLearned() {
    clear(learnedNode);
    if (!knowledge.knows.length) {
      learnedNode.append(h("div", { class: "empty small", text: "Cuando Doriath lea tus documentos, aquí verás lo que ha aprendido." }));
      return;
    }
    learnedNode.append(h("p", { class: "small muted", style: { marginBottom: "10px" }, text: `${knowledge.total} cosas aprendidas de tus documentos y de tus correcciones.` }));
    for (const item of knowledge.knows.slice(0, 12)) {
      learnedNode.append(h("div", { class: "learned" }, h("span", { class: "learned__tick", text: "✓" }), h("span", { text: item.summary || item.title })));
    }
  }

  function howItWorksCard() {
    return h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
      h("div", { class: "card card--sand" },
        h("p", { class: "ante-title", text: "Cómo funciona" }),
        h("div", { style: { marginTop: "12px" } },
          [["Sube documentos", "Manuales, procedimientos, presentaciones… lo que ya tenga tu equipo."],
            ["Doriath los lee", "Se queda con lo importante y te avisa si dos documentos se contradicen."],
            ["Pregunta y corrige", "Si una respuesta no te encaja, se lo dices y lo aprende para siempre."]]
            .map(([title, text], index) => h("div", { class: "step" },
              h("div", { class: "step__n", text: String(index + 1) }),
              h("div", {}, h("div", { style: { fontWeight: 700 }, text: title }), h("div", { class: "small muted", text })))))));
  }

  /* ---------- Preguntar y corregir ---------- */
  async function mountChat() {
    clear(chatHost);
    const card = h("div", { class: "card card--chat" },
      h("div", { class: "card__header" },
        h("div", {}, h("p", { class: "ante-title", text: "Paso 2" }), h("h2", { text: "Pregunta a tu base de conocimiento" })),
        h("span", { class: "chip chip--outline", text: "Corrige lo que no te encaje" })));
    chatHost.append(card);
    try {
      const existing = await get(`/api/chats?kind=assistant&sourceId=${source.id}`);
      const chat = existing.chats?.[0] || await post("/api/chats", { kind: "assistant", title: `Preguntas sobre ${source.name}`, sourceIds: [source.id] });
      const view = createChatView({
        chatId: chat.id,
        placeholder: "Escribe tu pregunta…",
        allowAttachments: false,
        decorateMessage: (message, node) => {
          if (message.role !== "assistant" || message.error || !message.content) return;
          node.append(h("div", { class: "answer-actions" },
            h("button", { class: "btn btn--outline btn--xs", text: "Es correcto", onclick: (event) => { event.target.closest(".answer-actions").replaceWith(h("div", { class: "chips", style: { marginTop: "8px" } }, h("span", { class: "chip chip--lime", text: "Confirmado por ti" }))); } }),
            h("button", { class: "btn btn--danger btn--xs", text: "No es así, corregir", onclick: (event) => openCorrection(message, node, event.target.closest(".answer-actions")) })));
        },
      });
      card.append(view.root);
    } catch (error) {
      card.append(h("div", { class: "callout callout--error", text: error.message }));
    }
  }

  function openCorrection(message, node, actions) {
    if (node.querySelector(".correction-panel")) return;
    const input = h("textarea", { class: "textarea", placeholder: "Escribe lo que es correcto. Por ejemplo: «el plazo son 24 horas, no 2 días»." });
    const panel = h("div", { class: "card card--canary correction-panel", style: { marginTop: "12px" } },
      h("p", { class: "ante-title", text: "Corrígeme" }),
      h("p", { class: "small", style: { marginBottom: "10px" }, text: "Dime qué es lo correcto y lo anoto en tu base de conocimiento. Quien la mantiene lo verá en el registro de cambios." }),
      input,
      h("div", { class: "card__actions", style: { marginTop: "12px", justifyContent: "flex-end" } },
        h("button", { class: "btn btn--outline btn--sm", text: "Cancelar", onclick: () => panel.remove() }),
        h("button", { class: "btn btn--sm", text: "Guardar la corrección", onclick: async () => {
          const correction = input.value.trim();
          if (!correction) { toast("Escribe la corrección primero.", "error"); return; }
          try {
            const result = await post(`/api/sources/${source.id}/corrections`, { correction, question: previousQuestion(message) });
            panel.remove();
            actions?.replaceWith(h("div", { class: "chips", style: { marginTop: "8px" } }, h("span", { class: "chip chip--canary", text: "Corregido por ti" })));
            await loadKnowledge();
            toast(result.unassigned ? "Apuntado. Quien mantiene la base lo revisará." : "Base de conocimiento actualizada", "ok");
          } catch (error) {
            toast(error.message, "error");
          }
        } })));
    node.append(panel);
    input.focus();
  }

  function previousQuestion(message) {
    const nodes = [...chatHost.querySelectorAll(".msg--user .md")];
    return nodes.length ? nodes[nodes.length - 1].textContent : String(message.content || "").slice(0, 120);
  }
}
