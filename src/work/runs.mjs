import path from "node:path";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { paths } from "../paths.mjs";
import { getConfig } from "../config.mjs";
import { readJson, writeJson, ensureDir } from "../util/fs.mjs";
import { eventBus } from "../util/events.mjs";
import { log } from "../util/log.mjs";
import { createCancellationToken, runCommand } from "../util/process.mjs";
import { runOneShot } from "../ai/copilot.mjs";
import { createKddTools, describeTools } from "../ai/tools.mjs";
import { getSource } from "../knowledge/sources.mjs";
import { getSpecStore } from "../kdd/store.mjs";
import { buildGraph, activationBundle, renderActivationBundle } from "../kdd/graph.mjs";
import { findSection } from "../kdd/sections.mjs";
import { listRegisteredRepositories, ensureBranch, workingTreeStatus, diffWorkingTree, commitAll, pushBranch, createPullRequest, recentLog, slugBranch, currentBranch } from "./repos.mjs";

/**
 * Ejecución de iniciativas Work sobre repositorios locales (fase Implement de KDD):
 *   1. el usuario elige la WRK-SPEC, las tareas y el repositorio de cada tarea;
 *   2. KDD Studio crea (o reutiliza) una rama por iniciativa en cada repositorio;
 *   3. cada tarea se implementa con una sesión Copilot con herramientas de edición acotadas al repo,
 *      con el conocimiento activado inyectado como contexto (bundle de activación);
 *   4. el usuario revisa el diff y confirma el commit; push y pull request son opcionales.
 * Nada se confirma en Git sin acción explícita del usuario.
 */
const activeTasks = new Map(); // `${runId}:${taskId}` -> token

function runFile(runId) {
  return path.join(paths.runsDir, `${runId}.json`);
}

async function saveRun(run) {
  run.updatedAt = new Date().toISOString();
  await ensureDir(paths.runsDir);
  await writeJson(runFile(run.id), run);
  return run;
}

export async function loadRun(runId) {
  const run = await readJson(runFile(runId), null);
  if (!run) throw Object.assign(new Error(`Ejecución no encontrada: ${runId}`), { status: 404 });
  return run;
}

export async function listRuns({ sourceId } = {}) {
  await ensureDir(paths.runsDir);
  const files = (await readdir(paths.runsDir)).filter((name) => name.endsWith(".json"));
  const runs = [];
  for (const file of files) {
    const run = await readJson(path.join(paths.runsDir, file), null);
    if (!run || (sourceId && run.sourceId !== sourceId)) continue;
    runs.push({ id: run.id, sourceId: run.sourceId, workSpecId: run.workSpecId, title: run.title, status: run.status, branch: run.branch, createdAt: run.createdAt, updatedAt: run.updatedAt, tasks: run.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, repositoryId: task.repositoryId })) });
  }
  return runs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function publish(run, type, data = {}) {
  eventBus.publish(`run:${run.id}`, type, { runId: run.id, ...data });
}

/** Árbol Work de una caja: iniciativas con planes y tareas. */
export function workTree(store) {
  const tasks = store.byLayer("work-task");
  const plans = store.byLayer("work-plan");
  return store.byLayer("work-spec").map((spec) => ({
    id: spec.id,
    title: spec.title,
    status: spec.status,
    confidence: spec.confidence,
    activates: spec.activates,
    updated: spec.updated,
    plans: plans.filter((plan) => plan.parent === spec.id).map((plan) => ({
      id: plan.id,
      title: plan.title,
      status: plan.status,
      tasks: tasks.filter((task) => task.parent === plan.id).map((task) => ({ id: task.id, title: task.title, status: task.status, task_kind: task.task_kind, repositoryHint: repositoryHint(task) })),
    })),
  })).sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
}

function repositoryHint(task) {
  const notes = findSection(task.body, "Implementation Notes")?.content || task.body;
  const match = /repositorio[^:\n]*:\s*[`*]*([A-Za-z0-9._-]+)/i.exec(notes) || /\*\*([A-Za-z0-9._-]+)\*\*\s*[—-]\s*ruta/i.exec(notes);
  return match ? match[1] : "";
}

/** Asigna automáticamente repositorio a cada tarea por nombre citado en sus notas. */
export function suggestRepositoryAssignments(tasks, repositories) {
  return tasks.map((task) => {
    const hint = repositoryHint(task).toLowerCase();
    const text = `${task.title} ${task.body}`.toLowerCase();
    const byHint = repositories.find((repo) => repo.name.toLowerCase() === hint);
    const byMention = repositories.find((repo) => text.includes(repo.name.toLowerCase()));
    return { taskId: task.id, repositoryId: (byHint || byMention || (repositories.length === 1 ? repositories[0] : null))?.id || "" };
  });
}

export async function createRun({ sourceId, workSpecId, taskIds, assignments = [], branch, model }) {
  const source = await getSource(sourceId);
  const store = await getSpecStore(source.path).load({ force: true });
  const workSpec = store.get(workSpecId);
  if (!workSpec || workSpec.layer !== "work-spec") throw Object.assign(new Error("La iniciativa no existe."), { status: 404 });
  const repositories = (await listRegisteredRepositories(source.path)).filter((repo) => repo.exists);
  const allTasks = store.byLayer("work-task").filter((task) => {
    const plan = store.get(task.parent);
    return plan && plan.parent === workSpec.id;
  });
  const selected = allTasks.filter((task) => !Array.isArray(taskIds) || !taskIds.length || taskIds.includes(task.id));
  if (!selected.length) throw Object.assign(new Error("La iniciativa no tiene tareas que ejecutar."), { status: 400 });
  const assignmentMap = new Map(assignments.map((item) => [item.taskId, item.repositoryId]));
  const suggested = new Map(suggestRepositoryAssignments(selected, repositories).map((item) => [item.taskId, item.repositoryId]));
  const config = getConfig();
  const run = {
    id: randomUUID(),
    sourceId,
    sourcePath: source.path,
    sourceCode: source.sourceId,
    workSpecId: workSpec.id,
    title: workSpec.title,
    branch: branch || `${config.work.branchPrefix || "feature/kdd"}/${slugBranch(`${workSpec.id}-${workSpec.title}`, 48)}`,
    model: model || "",
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    repositories: repositories.map((repo) => ({ id: repo.id, name: repo.name, path: repo.path, branch: repo.branch, remote: repo.remote })),
    tasks: selected.map((task) => ({
      id: task.id,
      title: task.title,
      planId: task.parent,
      taskKind: task.task_kind || "implementation",
      repositoryId: assignmentMap.get(task.id) || suggested.get(task.id) || "",
      status: "pending",
      attempts: 0,
      log: [],
      summary: "",
      diff: "",
      files: [],
      commit: null,
      error: "",
    })),
    log: [],
  };
  await saveRun(run);
  return run;
}

export async function updateRun(runId, patch) {
  const run = await loadRun(runId);
  if (patch.branch) run.branch = String(patch.branch);
  if (Array.isArray(patch.assignments)) {
    for (const item of patch.assignments) {
      const task = run.tasks.find((entry) => entry.id === item.taskId);
      if (task) task.repositoryId = item.repositoryId || "";
    }
  }
  if (patch.model !== undefined) run.model = String(patch.model || "");
  return saveRun(run);
}

function pushLog(run, task, message) {
  const entry = { at: new Date().toISOString(), message };
  if (task) task.log = [...(task.log || []), entry].slice(-300);
  else run.log = [...(run.log || []), entry].slice(-300);
  publish(run, "log", { taskId: task?.id, message });
}

function buildTaskPrompt({ workSpec, plan, task, siblings, bundle, repo, previousSummaries }) {
  const acceptance = findSection(task.body, "Acceptance Criteria")?.content || "";
  return `# Tarea a implementar: ${task.id} — ${task.title}

Trabajas dentro del repositorio **${repo.name}** (ruta ${repo.path}, rama ${repo.branch}). Implementa la tarea editando los ficheros necesarios con tus herramientas. No te limites a describir la solución: aplica los cambios. No ejecutes comandos que modifiquen el sistema fuera del repositorio ni hagas commits (KDD Studio los hace tras la revisión del usuario).

## Iniciativa (WRK-SPEC ${workSpec.id} — ${workSpec.title})

${workSpec.body}

## Plan (${plan?.id || "sin plan"} — ${plan?.title || ""})

${plan?.body || "(sin plan)"}

## Tarea

${task.body}

## Otras tareas del plan (contexto, no las implementes aquí)

${siblings.map((item) => `- ${item.id}: ${item.title} (${item.status})`).join("\n") || "(ninguna)"}

${previousSummaries.length ? `## Resultado de tareas ya ejecutadas en esta iniciativa\n\n${previousSummaries.map((item) => `### ${item.id}\n${item.summary}`).join("\n\n")}\n` : ""}
## Conocimiento activado (KDD)

${bundle}

## Cómo trabajar

1. Explora el repositorio (estructura, módulos, convenciones, tests existentes) antes de tocar nada.
2. Aplica los cambios siguiendo los patrones del repositorio y las reglas de dominio activadas.
3. Añade o adapta pruebas cuando el repositorio ya tenga suite de tests.
4. Si hay una decisión de diseño con consecuencias que el usuario debería tomar, tómala de forma conservadora y déjala explícita en el informe final.
5. Termina con un **informe final en Markdown** con estas secciones: \`## Resumen\`, \`## Ficheros modificados\` (lista), \`## Decisiones\`, \`## Pendiente / Riesgos\`, \`## Cómo probar\`. Comprueba que los criterios de aceptación quedan cubiertos:\n${acceptance}`;
}

async function repoStacksCommands(repoPath) {
  const { detectStacks } = await import("./repos.mjs");
  return detectStacks(repoPath);
}

/** Ejecuta una tarea (implementación con el agente) sobre su repositorio. */
export async function executeTask(runId, taskId) {
  const run = await loadRun(runId);
  const task = run.tasks.find((item) => item.id === taskId);
  if (!task) throw Object.assign(new Error("Tarea no encontrada en la ejecución."), { status: 404 });
  if (task.status === "running") throw Object.assign(new Error("La tarea ya se está ejecutando."), { status: 409 });
  const repo = run.repositories.find((item) => item.id === task.repositoryId);
  if (!repo) throw Object.assign(new Error("Asigna un repositorio a la tarea antes de ejecutarla."), { status: 400 });
  const key = `${runId}:${taskId}`;
  const token = createCancellationToken();
  activeTasks.set(key, token);
  task.status = "running";
  task.attempts += 1;
  task.error = "";
  task.startedAt = new Date().toISOString();
  run.status = "running";
  await saveRun(run);
  publish(run, "task", { taskId, status: task.status });
  (async () => {
    try {
      const config = getConfig();
      const source = await getSource(run.sourceId);
      const store = await getSpecStore(source.path).load({ force: true });
      const workSpec = store.get(run.workSpecId);
      const taskSpec = store.get(task.id);
      const plan = store.get(taskSpec?.parent);
      if (!workSpec || !taskSpec) throw new Error("La iniciativa o la tarea ya no existen en la base de conocimiento.");
      pushLog(run, task, `Preparando rama ${run.branch} en ${repo.name}…`);
      const branch = await ensureBranch(repo.path, run.branch);
      repo.branch = branch.branch;
      const dirtyBefore = await workingTreeStatus(repo.path);
      if (dirtyBefore.length) pushLog(run, task, `Aviso: el repositorio tenía ${dirtyBefore.length} cambio(s) sin confirmar antes de empezar; se conservan.`);
      const graph = buildGraph(store.all());
      const bundle = renderActivationBundle(activationBundle(graph, { explicitIds: workSpec.activates || [], layer: "work-task" }));
      const siblings = store.byLayer("work-task").filter((item) => item.parent === taskSpec.parent && item.id !== task.id);
      const previousSummaries = run.tasks.filter((item) => item.id !== task.id && item.summary).map((item) => ({ id: item.id, summary: item.summary }));
      const kddTools = await createKddTools({ contexts: [{ source, store }], repos: [] });
      const prompt = buildTaskPrompt({ workSpec, plan, task: taskSpec, siblings, bundle, repo, previousSummaries });
      const systemMessage = `Eres un ingeniero de software senior que implementa tareas KDD en repositorios de BBVA CIB. Idioma: español. Trabaja únicamente dentro de ${repo.path}. Herramientas de conocimiento disponibles:\n${describeTools(kddTools)}`;
      pushLog(run, task, "Sesión Copilot iniciada; implementando…");
      const result = await runOneShot({
        config,
        workingDirectory: repo.path,
        systemMessage,
        prompt,
        tools: kddTools,
        permissionProfile: "implementation",
        workspaceRoots: [repo.path],
        model: run.model || undefined,
        cancellationToken: token,
        timeoutMs: Math.max(config.copilot.timeoutMs, 30 * 60 * 1000),
        onEvent: (event) => {
          if (event.type === "tool") pushLog(run, task, `${event.name}${event.target ? ` → ${event.target}` : ""}`);
          else if (event.type === "error") pushLog(run, task, `Error: ${event.message}`);
          else if (event.type === "delta") publish(run, "delta", { taskId, text: event.text });
        },
      });
      const files = await workingTreeStatus(repo.path);
      task.files = files;
      task.diff = await diffWorkingTree(repo.path);
      task.summary = result.content;
      task.usage = result.usage;
      task.model = result.model;
      task.status = files.length ? "review" : "no-changes";
      task.finishedAt = new Date().toISOString();
      pushLog(run, task, files.length ? `Implementación terminada: ${files.length} fichero(s) modificado(s). Revisa el diff y confirma.` : "La sesión terminó sin cambios en el repositorio.");
    } catch (error) {
      task.status = error.code === "CANCELLED" ? "cancelled" : "failed";
      task.error = error.message;
      task.finishedAt = new Date().toISOString();
      pushLog(run, task, `Fallo: ${error.message}`);
      log.error("runs", `Tarea ${taskId} de ${runId}: ${error.stack || error.message}`);
    } finally {
      activeTasks.delete(key);
      run.status = run.tasks.some((item) => item.status === "running") ? "running" : "ready";
      await saveRun(run);
      publish(run, "task", { taskId, status: task.status, error: task.error });
    }
  })();
  return run;
}

export async function cancelTask(runId, taskId) {
  const token = activeTasks.get(`${runId}:${taskId}`);
  if (!token) return false;
  token.cancel();
  return true;
}

export async function refreshTaskDiff(runId, taskId) {
  const run = await loadRun(runId);
  const task = run.tasks.find((item) => item.id === taskId);
  const repo = run.repositories.find((item) => item.id === task?.repositoryId);
  if (!task || !repo) throw Object.assign(new Error("Tarea o repositorio no encontrados."), { status: 404 });
  task.files = await workingTreeStatus(repo.path);
  task.diff = await diffWorkingTree(repo.path);
  await saveRun(run);
  return { files: task.files, diff: task.diff };
}

export async function commitTask(runId, taskId, { message }) {
  const run = await loadRun(runId);
  const task = run.tasks.find((item) => item.id === taskId);
  const repo = run.repositories.find((item) => item.id === task?.repositoryId);
  if (!task || !repo) throw Object.assign(new Error("Tarea o repositorio no encontrados."), { status: 404 });
  const config = getConfig();
  const text = String(message || "").trim() || `feat(${task.id}): ${task.title}`;
  const result = await commitAll(repo.path, `${text}\n\nKDD: ${run.workSpecId} / ${task.id}`, { author: config.work.commitAuthor || undefined });
  if (result.committed) {
    task.commit = { sha: result.sha, message: text, at: new Date().toISOString() };
    task.status = "committed";
    task.diff = "";
    pushLog(run, task, `Commit ${result.sha} en ${repo.name} (${run.branch}).`);
  } else {
    pushLog(run, task, result.message);
  }
  await saveRun(run);
  publish(run, "task", { taskId, status: task.status });
  return { task, result };
}

export async function discardTaskChanges(runId, taskId) {
  const run = await loadRun(runId);
  const task = run.tasks.find((item) => item.id === taskId);
  const repo = run.repositories.find((item) => item.id === task?.repositoryId);
  if (!task || !repo) throw Object.assign(new Error("Tarea o repositorio no encontrados."), { status: 404 });
  const { git } = await import("./repos.mjs");
  const reset = await git(repo.path, ["checkout", "--", "."]);
  const clean = await git(repo.path, ["clean", "-fd"]);
  task.status = "pending";
  task.diff = "";
  task.files = [];
  pushLog(run, task, `Cambios descartados en ${repo.name}.${reset.ok && clean.ok ? "" : " (con avisos)"}`);
  await saveRun(run);
  publish(run, "task", { taskId, status: task.status });
  return task;
}

export async function pushRun(runId, { repositoryId }) {
  const run = await loadRun(runId);
  const repo = run.repositories.find((item) => item.id === repositoryId);
  if (!repo) throw Object.assign(new Error("Repositorio no encontrado."), { status: 404 });
  const branch = await currentBranch(repo.path);
  const result = await pushBranch(repo.path, branch || run.branch);
  pushLog(run, null, `Push de ${branch || run.branch} en ${repo.name}.`);
  run.pushes = [...(run.pushes || []), { repositoryId, branch: branch || run.branch, at: new Date().toISOString() }];
  await saveRun(run);
  return result;
}

export async function openPullRequest(runId, { repositoryId, title, body, base }) {
  const run = await loadRun(runId);
  const repo = run.repositories.find((item) => item.id === repositoryId);
  if (!repo) throw Object.assign(new Error("Repositorio no encontrado."), { status: 404 });
  const config = getConfig();
  const committed = run.tasks.filter((task) => task.repositoryId === repositoryId && task.commit);
  const prTitle = title || `${run.workSpecId}: ${run.title}`;
  const prBody = body || `Iniciativa KDD ${run.workSpecId} — ${run.title}\n\nTareas incluidas:\n${committed.map((task) => `- ${task.id}: ${task.title} (${task.commit.sha})`).join("\n")}\n\nGenerado con KDD Studio.`;
  const result = await createPullRequest(repo.path, { title: prTitle, body: prBody, base, host: config.github.host });
  run.pullRequests = [...(run.pullRequests || []), { repositoryId, url: result.url, at: new Date().toISOString() }];
  pushLog(run, null, `Pull request creada en ${repo.name}: ${result.url}`);
  await saveRun(run);
  return result;
}

export async function runRepositoryCommand(runId, { repositoryId, kind }) {
  const run = await loadRun(runId);
  const repo = run.repositories.find((item) => item.id === repositoryId);
  if (!repo) throw Object.assign(new Error("Repositorio no encontrado."), { status: 404 });
  const stacks = await repoStacksCommands(repo.path);
  const stack = stacks.find((item) => item[kind === "build" ? "buildCommand" : "testCommand"]);
  if (!stack) return { ok: false, skipped: true, output: "No se detectó un comando para este repositorio." };
  const [command, args] = stack[kind === "build" ? "buildCommand" : "testCommand"];
  pushLog(run, null, `Ejecutando ${command} ${args.join(" ")} en ${repo.name}…`);
  const result = await runCommand(command, args, { cwd: repo.path, timeoutMs: 20 * 60 * 1000 });
  pushLog(run, null, `${command} terminó con código ${result.code}.`);
  return { ok: result.ok, code: result.code, output: `${result.stdout}\n${result.stderr}`.trim().slice(-20000) };
}

export async function markTaskStatus(runId, taskId, status) {
  const run = await loadRun(runId);
  const task = run.tasks.find((item) => item.id === taskId);
  if (!task) throw Object.assign(new Error("Tarea no encontrada."), { status: 404 });
  task.status = status;
  await saveRun(run);
  return task;
}

export async function repositoryLog(runId, repositoryId) {
  const run = await loadRun(runId);
  const repo = run.repositories.find((item) => item.id === repositoryId);
  if (!repo) throw Object.assign(new Error("Repositorio no encontrado."), { status: 404 });
  return recentLog(repo.path, 15);
}
