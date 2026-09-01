import { HttpError, sendFile } from "../server.mjs";
import { listChats, loadChat, createChat, deleteChat, updateChat, sendMessage, abortChat, confirmPackage, discardPackage, updatePackageSpec } from "../assistant/chats.mjs";
import { listOutputs, deleteOutput, resolveOutputPath, outputsRoot } from "../assistant/outputs.mjs";

export function registerAssistantRoutes(router) {
  router.get("/api/chats", async ({ query }) => ({ chats: await listChats({ kind: query.kind, sourceId: query.sourceId }) }));
  router.post("/api/chats", async ({ body }) => createChat(body || {}));
  router.get("/api/chats/:id", async ({ params }) => loadChat(params.id));
  router.put("/api/chats/:id", async ({ params, body }) => updateChat(params.id, body || {}));
  router.delete("/api/chats/:id", async ({ params }) => ({ removed: await deleteChat(params.id) }));
  router.post("/api/chats/:id/messages", async ({ params, body }) => sendMessage(params.id, { text: body?.text || "", attachments: body?.attachments || [] }));
  router.post("/api/chats/:id/abort", async ({ params }) => ({ aborted: await abortChat(params.id) }));
  router.post("/api/chats/:id/package/confirm", async ({ params, body }) => confirmPackage(params.id, { force: Boolean(body?.force) }));
  router.post("/api/chats/:id/package/discard", async ({ params }) => ({ discarded: await discardPackage(params.id) }));
  router.put("/api/chats/:id/package/specs/:specId", async ({ params, body }) => updatePackageSpec(params.id, params.specId, body || {}));

  router.get("/api/outputs", async ({ query }) => ({ root: outputsRoot(), outputs: await listOutputs({ folder: query.folder }) }));
  router.get("/api/outputs/download", async ({ query, res }) => {
    if (!query.path) throw new HttpError(400, "Indica el fichero.");
    const file = resolveOutputPath(query.path);
    await sendFile(res, file, { download: query.inline !== "1" });
  });
  router.delete("/api/outputs", async ({ query }) => ({ removed: await deleteOutput(query.path) }));
}
