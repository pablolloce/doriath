import path from "node:path";
import { HttpError } from "../server.mjs";
import { getSource, listSources } from "../knowledge/sources.mjs";
import { getSpecStore } from "../kdd/store.mjs";
import { scanForRepositories, listRegisteredRepositories, registerRepositories, unregisterRepository, refreshRepositories, inspectRepository } from "../work/repos.mjs";
import { workTree, createRun, loadRun, listRuns, updateRun, executeTask, cancelTask, refreshTaskDiff, commitTask, discardTaskChanges, pushRun, openPullRequest, runRepositoryCommand, markTaskStatus, repositoryLog, suggestRepositoryAssignments } from "../work/runs.mjs";
import { pathExists, isPathWithin, normalizeUserPath } from "../util/fs.mjs";
import { getConfig } from "../config.mjs";

export function registerWorkRoutes(router) {
  router.get("/api/sources/:id/work", async ({ params }) => {
    const source = await getSource(params.id);
    const store = await getSpecStore(source.path).load();
    return { tree: workTree(store) };
  });

  router.get("/api/sources/:id/repositories", async ({ params, query }) => {
    const source = await getSource(params.id);
    return { repositories: query.refresh === "1" ? await refreshRepositories(source.path) : await listRegisteredRepositories(source.path) };
  });

  router.post("/api/repositories/scan", async ({ body }) => {
    const roots = (Array.isArray(body?.paths) ? body.paths : [body?.path]).map(normalizeUserPath).filter(Boolean);
    if (!roots.length) throw new HttpError(400, "Indica al menos una carpeta.");
    for (const root of roots) if (!(await pathExists(root))) throw new HttpError(400, `La carpeta no existe: ${root}`);
    return { repositories: await scanForRepositories(roots, { maxDepth: Number(body?.depth) || 3 }) };
  });

  router.post("/api/sources/:id/repositories", async ({ params, body }) => {
    const source = await getSource(params.id);
    const repositories = Array.isArray(body?.repositories) ? body.repositories : [];
    // Un repositorio no puede vivir en la carpeta de salidas del asistente ni dentro de (o
    // conteniendo a) una base de conocimiento: mezclarlos ensucia el repo con documentos generados o
    // specs que no le pertenecen.
    const outputs = getConfig().paths.outputs;
    const sources = await listSources();
    const inspected = [];
    for (const repo of repositories) {
      if (!repo?.path || !(await pathExists(repo.path))) continue;
      const resolved = path.resolve(repo.path);
      if (outputs && (isPathWithin(resolved, outputs) || isPathWithin(outputs, resolved))) {
        throw new HttpError(400, `${repo.path} coincide con la carpeta de salidas. Un repositorio no puede vivir en la misma ruta donde el asistente genera documentos.`);
      }
      const overlapping = sources.find((candidate) => isPathWithin(resolved, candidate.path) || isPathWithin(candidate.path, resolved));
      if (overlapping) {
        throw new HttpError(400, `${repo.path} coincide con la base de conocimiento "${overlapping.name}". Un repositorio no puede vivir dentro de una base de conocimiento, ni al revés.`);
      }
      inspected.push({ ...(await inspectRepository(repo.path)), ...(repo.id ? { id: repo.id } : {}) });
    }
    return { repositories: await registerRepositories(source.path, inspected) };
  });

  router.delete("/api/sources/:id/repositories/:repoId", async ({ params }) => {
    const source = await getSource(params.id);
    return { repositories: await unregisterRepository(source.path, params.repoId) };
  });

  router.get("/api/runs", async ({ query }) => ({ runs: await listRuns({ sourceId: query.sourceId }) }));
  router.post("/api/runs", async ({ body }) => createRun(body || {}));
  router.get("/api/runs/:id", async ({ params }) => loadRun(params.id));
  router.put("/api/runs/:id", async ({ params, body }) => updateRun(params.id, body || {}));
  router.post("/api/runs/:id/suggest", async ({ params }) => {
    const run = await loadRun(params.id);
    const source = await getSource(run.sourceId);
    const store = await getSpecStore(source.path).load();
    const tasks = run.tasks.map((task) => store.get(task.id)).filter(Boolean);
    return { assignments: suggestRepositoryAssignments(tasks, run.repositories) };
  });
  router.post("/api/runs/:id/tasks/:taskId/execute", async ({ params }) => executeTask(params.id, params.taskId));
  router.post("/api/runs/:id/tasks/:taskId/cancel", async ({ params }) => ({ cancelled: await cancelTask(params.id, params.taskId) }));
  router.get("/api/runs/:id/tasks/:taskId/diff", async ({ params }) => refreshTaskDiff(params.id, params.taskId));
  router.post("/api/runs/:id/tasks/:taskId/commit", async ({ params, body }) => commitTask(params.id, params.taskId, { message: body?.message }));
  router.post("/api/runs/:id/tasks/:taskId/discard", async ({ params }) => discardTaskChanges(params.id, params.taskId));
  router.post("/api/runs/:id/tasks/:taskId/status", async ({ params, body }) => markTaskStatus(params.id, params.taskId, String(body?.status || "pending")));
  router.post("/api/runs/:id/push", async ({ params, body }) => pushRun(params.id, { repositoryId: body?.repositoryId }));
  router.post("/api/runs/:id/pull-request", async ({ params, body }) => openPullRequest(params.id, body || {}));
  router.post("/api/runs/:id/command", async ({ params, body }) => runRepositoryCommand(params.id, { repositoryId: body?.repositoryId, kind: body?.kind || "test" }));
  router.get("/api/runs/:id/repositories/:repoId/log", async ({ params }) => ({ log: await repositoryLog(params.id, params.repoId) }));
}
