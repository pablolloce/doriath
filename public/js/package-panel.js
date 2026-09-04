/**
 * Panel de revisión de lo que propone un chat de creación (Work o Knowledge).
 *
 * En el chat de conocimiento se habla de specs, porque lo usa quien mantiene la base. En el de
 * trabajo se habla de features e historias de usuario y no se enseñan identificadores: ahí el
 * módulo lo usa gente que no tiene por qué saber que existe una spec.
 */
import { post, put } from "./api.js";
import { h, md, toast, confirmDialog, statusChip, layerChip, openModal, modalHeader, clear } from "./ui.js";
import { isAdmin } from "./app.js";

const KIND_LABELS = { implementation: "Código", document: "Documento", "test-cases": "Casos de prueba", manual: "Manual" };

export function renderPackagePanel({ chatId, pkg, onChanged, layers = [], plain = false }) {
  const root = h("div", { class: "card" });
  const heading = plain ? "Propuesta" : "Paquete propuesto";
  const showId = !plain || isAdmin();
  if (!pkg) {
    root.append(h("p", { class: "ante-title", text: heading }), h("div", { class: "empty", text: plain ? "Cuando KDD Studio proponga las features y sus historias de usuario aparecerán aquí para que las revises y las guardes." : "Cuando el asistente proponga specs aparecerán aquí para revisarlas y confirmarlas." }));
    return root;
  }
  const labelFor = (layer) => layers.find((item) => item.id === layer)?.label || layer;
  const list = h("div", { class: "list" });
  const renderList = () => {
    clear(list);
    for (const spec of pkg.specs) {
      const errors = (spec.issues || []).filter((issue) => issue.severity === "error");
      const warnings = (spec.issues || []).filter((issue) => issue.severity === "warning");
      list.append(h("div", { class: `list-item${spec.selected === false ? "" : ""}` },
        h("label", { class: "checkbox" }, h("input", { type: "checkbox", checked: spec.selected !== false, onchange: async (event) => { await put(`/api/chats/${chatId}/package/specs/${spec.id}`, { selected: event.target.checked }); spec.selected = event.target.checked; } })),
        h("div", { class: "list-item__main", style: { flex: 1 } },
          h("div", { class: "list-item__title" }, showId ? h("span", { class: "mono", text: spec.id }) : null, showId ? " " : null, spec.title),
          h("div", { class: "chips" }, layerChip(spec.layer, labelFor(spec.layer)), statusChip(spec.status), spec.parent && showId ? h("span", { class: "chip chip--outline", text: `padre ${spec.parent}` }) : null, spec.task_kind ? h("span", { class: "chip chip--ice", text: KIND_LABELS[spec.task_kind] || spec.task_kind }) : null, errors.length ? h("span", { class: "chip chip--mandarin", text: `${errors.length} bloqueante${errors.length > 1 ? "s" : ""}` }) : null, warnings.length ? h("span", { class: "chip chip--canary", text: `${warnings.length} aviso${warnings.length > 1 ? "s" : ""}` }) : null)),
        h("button", { class: "btn btn--outline btn--xs", text: "Ver", onclick: () => openSpec(spec) })));
    }
    for (const modification of pkg.modifications || []) {
      list.append(h("div", { class: "list-item" },
        h("div", { class: "list-item__main" }, h("div", { class: "list-item__title" }, h("span", { class: "mono", text: modification.id }), modification.status ? ` → ${modification.status}` : " (cambio propuesto)"), h("div", { class: "list-item__meta", text: modification.reasoning || "" })),
        modification.body ? h("button", { class: "btn btn--outline btn--xs", text: "Ver", onclick: () => openSpec({ id: modification.id, title: "Modificación propuesta", body: modification.body, issues: [] }) }) : null));
    }
  };
  const openSpec = (spec) => {
    const { close } = openModal([], { wide: true });
    const body = h("textarea", { class: "textarea textarea--code", text: spec.body || "" });
    const title = h("input", { class: "input", value: spec.title || "" });
    document.querySelector(".modal").append(
      modalHeader(showId ? spec.id : spec.title, close, spec.layer ? labelFor(spec.layer) : ""),
      (spec.issues || []).length ? h("div", { class: "list" }, spec.issues.map((issue) => h("div", { class: `callout ${issue.severity === "error" ? "callout--error" : "callout--warn"}`, text: issue.message }))) : null,
      spec.reasoning ? h("p", { class: "muted small", text: spec.reasoning }) : null,
      h("div", { class: "field" }, h("label", { text: "Título" }), title),
      h("div", { class: "field" }, h("label", { text: "Cuerpo (Markdown)" }), body),
      h("div", { class: "card__actions", style: { justifyContent: "flex-end" } },
        spec.layer ? h("button", { class: "btn", text: "Guardar cambios", onclick: async () => {
          try {
            const updated = await put(`/api/chats/${chatId}/package/specs/${spec.id}`, { title: title.value, body: body.value });
            Object.assign(pkg, updated);
            renderList();
            renderStatus();
            close();
            toast(plain ? "Cambio guardado en la propuesta" : "Spec actualizada en el paquete", "ok");
          } catch (error) {
            toast(error.message, "error");
          }
        } }) : null),
      h("div", { class: "card card--sand" }, h("p", { class: "ante-title", text: "Vista previa" }), md(spec.body || "")),
    );
  };
  const status = h("div");
  const renderStatus = () => {
    clear(status);
    if (pkg.warnings?.length) status.append(h("div", { class: "callout callout--warn small", html: pkg.warnings.map((warning) => `• ${warning}`).join("<br>") }));
    if (pkg.blocking) status.append(h("div", { class: "callout callout--error small", text: plain ? "Hay puntos que hay que resolver antes de guardar. Pídeselo a KDD Studio (\"corrige la propuesta\") o edítalos aquí." : "Hay specs con incidencias bloqueantes. Pide al asistente que las corrija (\"corrige el paquete\") o edítalas aquí antes de confirmar." }));
  };
  root.append(
    h("div", { class: "card__header" }, h("div", {}, h("p", { class: "ante-title", text: heading }), h("h3", { text: pkg.summary })), showId ? h("span", { class: "chip chip--outline", text: pkg.id }) : null),
    status,
    list,
    h("div", { class: "card__actions", style: { marginTop: "16px" } },
      h("button", { class: "btn btn--lime", text: plain ? "Guardar la propuesta" : "Confirmar y persistir", onclick: async () => {
        try {
          const result = await post(`/api/chats/${chatId}/package/confirm`, { force: pkg.kind !== "work" });
          const failed = result.results.filter((item) => item.action === "error");
          const saved = result.results.length - failed.length;
          const noun = plain ? "elementos de la iniciativa" : "specs";
          toast(failed.length ? `Guardados ${saved} ${noun}; ${failed.length} con error` : `Guardados ${result.results.length} ${noun}`, failed.length ? "error" : "ok", 6000);
          onChanged?.(result);
        } catch (error) {
          toast(error.message, "error", 7000);
        }
      } }),
      h("button", { class: "btn btn--outline", text: "Descartar", onclick: async () => {
        if (await confirmDialog(plain ? "Descartar propuesta" : "Descartar paquete", "Se descarta la propuesta actual. Puedes pedir otra al asistente.", { okLabel: "Descartar", danger: true })) {
          await post(`/api/chats/${chatId}/package/discard`);
          onChanged?.(null);
        }
      } })),
  );
  renderStatus();
  renderList();
  return root;
}
