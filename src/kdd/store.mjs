import { readFile, writeFile, readdir, stat, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { LAYERS, allLayerFolders, analysisDir, cacheDir, documentsDir, layerFolder, DECISION_HISTORY_FILE } from "./layout.mjs";
import { parseSpecMarkdown, serializeSpecMarkdown, bumpVersion } from "./frontmatter.mjs";
import { validateSpecStructure, summarizeSpec } from "./sections.mjs";
import { readJson, writeJson, ensureDir, slugify } from "../util/fs.mjs";

/**
 * Almacén de specs de una base de conocimiento local. Lee los ficheros Markdown de `specs/**`,
 * mantiene una caché en memoria por mtime y ofrece operaciones de escritura con salvaguardas:
 *  - una spec con confianza media/alta o `manual-edits` no se sobrescribe desde una propuesta del
 *    asistente (solo se añade evidencia y se sube la versión), como en KDD Studio;
 *  - deprecar conserva la spec y sus relaciones; borrar es explícito.
 */
export class SpecStore {
  constructor(sourceDir) {
    this.sourceDir = path.resolve(sourceDir);
    this.cache = new Map(); // filePath -> { mtimeMs, spec }
    this.problems = [];
    this.loadedAt = 0;
  }

  async ensureLayout() {
    for (const { dir } of allLayerFolders(this.sourceDir)) await mkdir(dir, { recursive: true });
    await mkdir(documentsDir(this.sourceDir), { recursive: true });
    await mkdir(cacheDir(this.sourceDir), { recursive: true });
    await mkdir(analysisDir(this.sourceDir), { recursive: true });
  }

  async load({ force = false } = {}) {
    if (!force && Date.now() - this.loadedAt < 1500) return this;
    const problems = [];
    const seen = new Set();
    for (const { layer, dir } of allLayerFolders(this.sourceDir)) {
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
        const filePath = path.join(dir, entry.name);
        seen.add(filePath);
        let info;
        try {
          info = await stat(filePath);
        } catch {
          continue;
        }
        const cached = this.cache.get(filePath);
        if (cached && cached.mtimeMs === info.mtimeMs) continue;
        const text = await readFile(filePath, "utf8");
        const { spec, errors, warnings } = parseSpecMarkdown(text, { filePath });
        if (!spec) {
          problems.push({ filePath, errors });
          this.cache.delete(filePath);
          continue;
        }
        if (spec.layer !== layer) warnings.push(`La spec ${spec.id} está en la carpeta de ${layer} pero declara capa ${spec.layer}.`);
        this.cache.set(filePath, { mtimeMs: info.mtimeMs, spec, warnings });
      }
    }
    for (const filePath of [...this.cache.keys()]) if (!seen.has(filePath)) this.cache.delete(filePath);
    this.problems = problems;
    this.loadedAt = Date.now();
    return this;
  }

  all() {
    return [...this.cache.values()].map((entry) => entry.spec);
  }

  ids() {
    return this.all().map((spec) => spec.id);
  }

  get(id) {
    const wanted = String(id || "").toUpperCase();
    for (const entry of this.cache.values()) if (entry.spec.id === wanted) return entry.spec;
    return null;
  }

  byLayer(layer) {
    return this.all().filter((spec) => spec.layer === layer);
  }

  byAxis(axis) {
    return this.all().filter((spec) => spec.axis === axis);
  }

  catalogEntry(spec) {
    return {
      id: spec.id,
      title: spec.title,
      layer: spec.layer,
      axis: spec.axis,
      layerLabel: LAYERS[spec.layer]?.label || spec.layer,
      status: spec.status,
      confidence: spec.confidence,
      version: spec.version,
      owner: spec.owner,
      domain: spec.domain,
      subdomain: spec.subdomain,
      tags: spec.tags,
      updated: spec.updated,
      created: spec.created,
      parent: spec.parent,
      activates: spec.activates,
      task_kind: spec.task_kind,
      dependencies: spec.dependencies,
      summary: summarizeSpec(spec),
      issues: validateSpecStructure(spec).filter((issue) => issue.severity === "error").length,
      filePath: spec.filePath,
    };
  }

  catalog() {
    return this.all().map((spec) => this.catalogEntry(spec)).sort((a, b) => a.id.localeCompare(b.id));
  }

  filePathFor(spec) {
    const base = `${spec.id}${spec.title ? `-${slugify(spec.title, 50)}` : ""}.md`;
    return path.join(layerFolder(this.sourceDir, spec.layer), base);
  }

  /** Crea una spec nueva. Falla si el id ya existe. */
  async create(spec, { generatedBy = "kdd" } = {}) {
    await this.load();
    if (this.get(spec.id)) throw new Error(`La spec ${spec.id} ya existe.`);
    const today = new Date().toISOString().slice(0, 10);
    const complete = {
      ...spec,
      status: spec.status || "draft",
      confidence: spec.confidence || "low",
      version: spec.version || "1.0.0",
      created: spec.created || today,
      updated: today,
      generatedBy: spec.generatedBy || generatedBy,
      generatedAt: spec.generatedAt || new Date().toISOString(),
    };
    const filePath = this.filePathFor(complete);
    await ensureDir(path.dirname(filePath));
    await writeFile(filePath, serializeSpecMarkdown(complete), "utf8");
    await this.load({ force: true });
    return this.get(complete.id);
  }

  /**
   * Actualiza una spec existente. `patch` puede traer body, title, status, confidence, tags,
   * dependencies, activates, owner... Si `protectValidated` está activo y la spec está validada
   * (confianza media/alta o ediciones manuales), no se toca el body: solo se anota evidencia.
   */
  async update(id, patch, { protectValidated = false, bump = "patch", manual = false, evidenceNote = "" } = {}) {
    await this.load();
    const current = this.get(id);
    if (!current) throw new Error(`La spec ${id} no existe.`);
    const protectedSpec = protectValidated && (current.confidence !== "low" || current.manualEdits);
    const today = new Date().toISOString().slice(0, 10);
    let body = current.body;
    if (patch.body !== undefined && !protectedSpec) body = String(patch.body);
    if (protectedSpec && (patch.body !== undefined || evidenceNote)) {
      body = appendEvidence(body, evidenceNote || "Propuesta del asistente no aplicada al cuerpo: la spec está validada.");
    } else if (evidenceNote) {
      body = appendEvidence(body, evidenceNote);
    }
    const next = {
      ...current,
      ...pickPatchFields(patch),
      body,
      updated: today,
      version: bump ? bumpVersion(current.version, bump) : current.version,
      manualEdits: manual ? true : current.manualEdits,
    };
    await writeFile(current.filePath, serializeSpecMarkdown(next), "utf8");
    if (next.title !== current.title || next.layer !== current.layer) {
      const newPath = this.filePathFor(next);
      if (newPath !== current.filePath) {
        await ensureDir(path.dirname(newPath));
        await writeFile(newPath, serializeSpecMarkdown(next), "utf8");
        await unlink(current.filePath).catch(() => undefined);
      }
    }
    await this.load({ force: true });
    return { spec: this.get(id), protected: protectedSpec };
  }

  async setStatus(id, status) {
    return this.update(id, { status }, { bump: null });
  }

  async remove(id) {
    await this.load();
    const current = this.get(id);
    if (!current) throw new Error(`La spec ${id} no existe.`);
    await unlink(current.filePath);
    await this.load({ force: true });
    return true;
  }

  /* ---------- Historial de decisiones ---------- */

  async readDecisionHistory() {
    const file = path.join(analysisDir(this.sourceDir), DECISION_HISTORY_FILE);
    const data = await readJson(file, { decisions: [] });
    return Array.isArray(data?.decisions) ? data.decisions : [];
  }

  async appendDecisions(entries) {
    const file = path.join(analysisDir(this.sourceDir), DECISION_HISTORY_FILE);
    const current = await this.readDecisionHistory();
    const next = [...current, ...entries.map((entry) => ({ at: new Date().toISOString(), ...entry }))].slice(-500);
    await writeJson(file, { decisions: next });
    return next;
  }
}

function pickPatchFields(patch) {
  const allowed = ["title", "status", "confidence", "owner", "domain", "subdomain", "tags", "dependencies", "activates", "parent", "task_kind", "reviewers", "supersedes", "source", "bbvaOne"];
  const out = {};
  for (const key of allowed) if (patch[key] !== undefined) out[key] = patch[key];
  if (out.dependencies) out.dependencies = out.dependencies.map((dep) => ({ id: String(dep.id).toUpperCase(), type: String(dep.type || dep.relation || "depends-on") }));
  if (out.activates) out.activates = out.activates.map((id) => String(id).toUpperCase());
  return out;
}

function appendEvidence(body, note) {
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `- ${stamp}: ${note}`;
  if (/^##\s+Evidence\s*$/m.test(body)) {
    return body.replace(/(^##\s+Evidence\s*$)([\s\S]*?)(?=^##\s|\s*$(?![\s\S]))/m, (match, header, content) => `${header}${content.replace(/\s*$/, "")}\n${line}\n\n`);
  }
  return `${body.trimEnd()}\n\n## Evidence\n\n${line}\n`;
}

const stores = new Map();

export function getSpecStore(sourceDir) {
  const key = path.resolve(sourceDir);
  if (!stores.has(key)) stores.set(key, new SpecStore(key));
  return stores.get(key);
}

export function dropSpecStore(sourceDir) {
  stores.delete(path.resolve(sourceDir));
}
