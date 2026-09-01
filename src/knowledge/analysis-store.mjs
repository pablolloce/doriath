import path from "node:path";
import { readdir } from "node:fs/promises";
import { paths } from "../paths.mjs";
import { readJson, writeJson, ensureDir } from "../util/fs.mjs";
import { analysisDir } from "../kdd/layout.mjs";

/**
 * Persistencia de análisis (jobs del Knowledge Base Studio) en la carpeta de datos y de las preguntas
 * pendientes de cada base de conocimiento en `specs/_analysis/pending-tasks.json`.
 */
function jobFile(jobId) {
  return path.join(paths.analysesDir, `${jobId}.json`);
}

export async function saveJob(job) {
  await ensureDir(paths.analysesDir);
  await writeJson(jobFile(job.id), job);
  return job;
}

export async function loadJob(jobId) {
  const job = await readJson(jobFile(jobId), null);
  if (!job) throw Object.assign(new Error(`Análisis no encontrado: ${jobId}`), { status: 404 });
  return job;
}

export async function listJobs({ sourceId } = {}) {
  await ensureDir(paths.analysesDir);
  const files = (await readdir(paths.analysesDir)).filter((name) => name.endsWith(".json"));
  const jobs = [];
  for (const file of files) {
    const job = await readJson(path.join(paths.analysesDir, file), null);
    if (!job || (sourceId && job.sourceId !== sourceId)) continue;
    jobs.push({
      id: job.id,
      sourceId: job.sourceId,
      documents: job.documents,
      status: job.status,
      phase: job.phase,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      specCount: job.preview?.specs?.length || 0,
      error: job.error || "",
    });
  }
  return jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function deleteJob(jobId) {
  const { unlink } = await import("node:fs/promises");
  await unlink(jobFile(jobId)).catch(() => undefined);
}

function pendingFile(sourceDir) {
  return path.join(analysisDir(sourceDir), "pending-tasks.json");
}

export async function readPendingTasks(sourceDir) {
  const data = await readJson(pendingFile(sourceDir), { pending: [] });
  return Array.isArray(data?.pending) ? data.pending : [];
}

export async function writePendingTasks(sourceDir, pending) {
  await writeJson(pendingFile(sourceDir), { pending });
}

export async function addPendingTasks(sourceDir, items) {
  const current = await readPendingTasks(sourceDir);
  const next = [...current];
  for (const item of items) {
    if (next.some((existing) => existing.text === item.text)) continue;
    next.push({ id: item.id, kind: item.kind || "question", text: item.text, document: item.document || "", at: new Date().toISOString() });
  }
  await writePendingTasks(sourceDir, next);
  return next;
}

export async function resolvePendingTask(sourceDir, id) {
  const current = await readPendingTasks(sourceDir);
  const next = current.filter((item) => item.id !== id);
  await writePendingTasks(sourceDir, next);
  return next;
}

/** Registro por documento de los análisis confirmados (para PREVIOUS_ANALYSIS). */
export async function readAnalysisRecord(sourceDir, documentName) {
  const file = path.join(analysisDir(sourceDir), "analyses.json");
  const data = await readJson(file, { records: [] });
  return (data.records || []).filter((record) => record.document === documentName).slice(-1)[0] || null;
}

export async function appendAnalysisRecord(sourceDir, record) {
  const file = path.join(analysisDir(sourceDir), "analyses.json");
  const data = await readJson(file, { records: [] });
  data.records = [...(data.records || []), record].slice(-200);
  await writeJson(file, data);
}
