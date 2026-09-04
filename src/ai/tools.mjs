import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { defineKddTool } from "./copilot.mjs";
import { buildSpecIndex, snippetFor } from "../kdd/search.mjs";
import { buildGraph, impact as graphImpact } from "../kdd/graph.mjs";
import { validateSpecStructure, findSection } from "../kdd/sections.mjs";
import { LAYERS } from "../kdd/layout.mjs";
import { listDocuments, getDocumentText, buildDocumentIndex } from "../knowledge/documents.mjs";
import { splitDocumentSections } from "../knowledge/extract.mjs";
import { readPendingTasks } from "../knowledge/analysis-store.mjs";
import { runCommand } from "../util/process.mjs";

/**
 * Herramientas de solo lectura que el asistente usa para CONSULTAR el conocimiento en vez de
 * recordarlo (mismo catálogo que KDD Studio). Trabajan sobre una o varias bases de conocimiento y,
 * opcionalmente, sobre los repositorios seleccionados para el trabajo.
 *
 * `contexts`: [{ source, store }] ya cargados. Los resultados indican siempre de qué caja vienen.
 */
export async function createKddTools({ contexts, repos = [] }) {
  const byId = () => {
    const map = new Map();
    for (const context of contexts) for (const spec of context.store.all()) map.set(spec.id, { spec, source: context.source });
    return map;
  };
  const reload = async () => {
    for (const context of contexts) await context.store.load();
  };
  const specSummary = (spec, source) => ({
    id: spec.id,
    title: spec.title,
    layer: spec.layer,
    layerLabel: LAYERS[spec.layer]?.label || spec.layer,
    status: spec.status,
    confidence: spec.confidence,
    knowledgeBase: source.name,
    sourceId: source.sourceId,
    domain: spec.domain || undefined,
    tags: spec.tags?.length ? spec.tags : undefined,
  });

  const tools = [];

  tools.push(await defineKddTool("search_specs", {
    description: "Búsqueda léxica (BM25) de specs por vocabulario en las bases de conocimiento disponibles. Devuelve id, título, capa, caja y un fragmento. Úsala antes de read_spec cuando no conozcas el id exacto.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Palabras clave o frase" }, layer: { type: "string", description: "Filtro opcional de capa: architecture, domain, product, feature, doc, work-spec, work-plan, work-task, adr, rfc, rule" }, limit: { type: "number", description: "Máximo de resultados (por defecto 8)" } }, required: ["query"] },
    handler: async ({ query, layer, limit }) => {
      await reload();
      const out = [];
      for (const context of contexts) {
        const specs = context.store.all().filter((spec) => !layer || spec.layer === layer);
        const index = buildSpecIndex(specs);
        for (const hit of index.search(query, { limit: Number(limit) || 8 })) {
          const spec = context.store.get(hit.id);
          out.push({ ...specSummary(spec, context.source), score: Number(hit.score.toFixed(2)), snippet: snippetFor(spec.body, query) });
        }
      }
      out.sort((a, b) => b.score - a.score);
      return out.slice(0, Number(limit) || 8);
    },
  }));

  tools.push(await defineKddTool("read_spec", {
    description: "Devuelve el contenido completo (frontmatter y body) de una spec por su identificador.",
    parameters: { type: "object", properties: { id: { type: "string", description: "Identificador de la spec, p. ej. DOM-RISK-S001-001" } }, required: ["id"] },
    handler: async ({ id }) => {
      await reload();
      const found = byId().get(String(id || "").toUpperCase());
      if (!found) return `No existe la spec ${id}.`;
      const { spec, source } = found;
      return `# ${spec.id} — ${spec.title}\nCaja: ${source.name} (${source.sourceId}) · capa ${spec.layer} · estado ${spec.status} · confianza ${spec.confidence} · versión ${spec.version}\nDependencias: ${(spec.dependencies || []).map((dep) => `${dep.id} (${dep.type})`).join(", ") || "ninguna"}\n${spec.activates?.length ? `Activa: ${spec.activates.join(", ")}\n` : ""}${spec.parent ? `Padre: ${spec.parent}\n` : ""}\n${spec.body}`;
    },
  }));

  tools.push(await defineKddTool("list_specs", {
    description: "Lista las specs de las bases de conocimiento (id, título, capa, estado, confianza). Admite filtros por capa, estado y caja.",
    parameters: { type: "object", properties: { layer: { type: "string" }, status: { type: "string" }, knowledgeBase: { type: "string", description: "Nombre o Source ID de la caja" }, limit: { type: "number" } } },
    handler: async ({ layer, status, knowledgeBase, limit }) => {
      await reload();
      const out = [];
      for (const context of contexts) {
        if (knowledgeBase && ![context.source.name, context.source.sourceId].some((value) => String(value).toLowerCase() === String(knowledgeBase).toLowerCase())) continue;
        for (const spec of context.store.all()) {
          if (layer && spec.layer !== layer) continue;
          if (status && spec.status !== status) continue;
          out.push(specSummary(spec, context.source));
        }
      }
      return out.sort((a, b) => a.id.localeCompare(b.id)).slice(0, Number(limit) || 200);
    },
  }));

  tools.push(await defineKddTool("validate_spec", {
    description: "Valida la estructura de una spec (secciones canónicas, criterios verificables, coherencia Work) y devuelve las incidencias.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    handler: async ({ id }) => {
      await reload();
      const found = byId().get(String(id || "").toUpperCase());
      if (!found) return `No existe la spec ${id}.`;
      const issues = validateSpecStructure(found.spec);
      return issues.length ? issues : "Sin incidencias estructurales.";
    },
  }));

  tools.push(await defineKddTool("spec_impact", {
    description: "Análisis de impacto: qué specs dependen directa o transitivamente de la indicada (grafo inverso).",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    handler: async ({ id }) => {
      await reload();
      const out = [];
      for (const context of contexts) {
        if (!context.store.get(String(id).toUpperCase())) continue;
        const graph = buildGraph(context.store.all());
        out.push(...graphImpact(graph, id).map((item) => ({ id: item.id, via: item.via, from: item.from, depth: item.depth, title: item.spec?.title || "", knowledgeBase: context.source.name })));
      }
      return out.length ? out : "Ninguna spec depende de esta.";
    },
  }));

  tools.push(await defineKddTool("list_work_items", {
    description: "Lista las iniciativas Work (WRK-SPEC) con sus planes y tareas, incluyendo estado.",
    parameters: { type: "object", properties: { status: { type: "string" } } },
    handler: async ({ status }) => {
      await reload();
      const out = [];
      for (const context of contexts) {
        const specs = context.store.byLayer("work-spec").filter((spec) => !status || spec.status === status);
        for (const spec of specs) {
          const plans = context.store.byLayer("work-plan").filter((plan) => plan.parent === spec.id);
          out.push({
            id: spec.id, title: spec.title, status: spec.status, knowledgeBase: context.source.name, activates: spec.activates,
            plans: plans.map((plan) => ({ id: plan.id, title: plan.title, status: plan.status, tasks: context.store.byLayer("work-task").filter((task) => task.parent === plan.id).map((task) => ({ id: task.id, title: task.title, status: task.status, task_kind: task.task_kind || undefined })) })),
          });
        }
      }
      return out.length ? out : "No hay iniciativas Work.";
    },
  }));

  tools.push(await defineKddTool("list_pending_tasks", {
    description: "Preguntas y conflictos pendientes de análisis anteriores en las bases de conocimiento.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const out = [];
      for (const context of contexts) {
        const pending = await readPendingTasks(context.source.path);
        out.push(...pending.map((item) => ({ ...item, knowledgeBase: context.source.name })));
      }
      return out.length ? out : "No hay preguntas pendientes.";
    },
  }));

  tools.push(await defineKddTool("get_open_questions", {
    description: "Devuelve la sección Open Questions de una WRK-SPEC (o de cualquier spec que la tenga).",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    handler: async ({ id }) => {
      await reload();
      const found = byId().get(String(id || "").toUpperCase());
      if (!found) return `No existe la spec ${id}.`;
      return findSection(found.spec.body, "Open Questions")?.content || "La spec no tiene preguntas abiertas.";
    },
  }));

  tools.push(await defineKddTool("search_decision_history", {
    description: "Busca en el historial de decisiones (preguntas resueltas en análisis y chats anteriores).",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    handler: async ({ query }) => {
      const tokens = String(query || "").toLowerCase().split(/\W+/).filter((token) => token.length > 3);
      const out = [];
      for (const context of contexts) {
        const decisions = await context.store.readDecisionHistory();
        for (const decision of decisions) {
          const text = `${decision.question || ""} ${decision.resolution || ""}`.toLowerCase();
          if (!tokens.length || tokens.some((token) => text.includes(token))) out.push({ ...decision, knowledgeBase: context.source.name });
        }
      }
      return out.length ? out.slice(-30) : "Sin decisiones que coincidan.";
    },
  }));

  tools.push(await defineKddTool("list_documents", {
    description: "Lista los documentos importados en las bases de conocimiento (docs-tecnicos).",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const out = [];
      for (const context of contexts) {
        const documents = await listDocuments(context.source.path);
        out.push(...documents.map((document) => ({ name: document.name, size: document.size, modified: document.modified, knowledgeBase: context.source.name })));
      }
      return out.length ? out : "No hay documentos importados.";
    },
  }));

  tools.push(await defineKddTool("search_document", {
    description: "Busca párrafos relevantes dentro de los documentos importados (BM25 por párrafo).",
    parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    handler: async ({ query, limit }) => {
      const out = [];
      for (const context of contexts) {
        const index = await buildDocumentIndex(context.source.path);
        for (const hit of index.search(query, { limit: Number(limit) || 8 })) {
          out.push({ document: hit.payload.document, position: hit.payload.position, knowledgeBase: context.source.name, score: Number(hit.score.toFixed(2)), text: hit.payload.text.slice(0, 800) });
        }
      }
      return out.sort((a, b) => b.score - a.score).slice(0, Number(limit) || 8);
    },
  }));

  tools.push(await defineKddTool("read_section", {
    description: "Lee una sección de un documento importado. Indica el nombre del documento y el título (o parte) de la sección; sin sección devuelve el índice de secciones.",
    parameters: { type: "object", properties: { document: { type: "string" }, section: { type: "string" }, maxChars: { type: "number" } }, required: ["document"] },
    handler: async ({ document, section, maxChars }) => {
      for (const context of contexts) {
        const documents = await listDocuments(context.source.path);
        const found = documents.find((item) => item.name.toLowerCase() === String(document).toLowerCase());
        if (!found) continue;
        const text = await getDocumentText(context.source.path, found.name);
        const sections = splitDocumentSections(text);
        if (!section) return sections.map((item) => `${item.index}. ${item.title} (${item.text.length} caracteres)`).join("\n");
        const needle = String(section).toLowerCase();
        const match = sections.find((item) => item.title.toLowerCase().includes(needle)) || sections[Number(section)] || null;
        if (!match) return `No se encontró la sección "${section}" en ${found.name}.`;
        const limit = Number(maxChars) || 12000;
        return `§ ${match.title}\n${match.text.length > limit ? `${match.text.slice(0, limit)}\n…(truncado)` : match.text}`;
      }
      return `Documento no encontrado: ${document}.`;
    },
  }));

  tools.push(await defineKddTool("grep_document", {
    description: "Busca una expresión regular en un documento importado y devuelve las líneas coincidentes con contexto.",
    parameters: { type: "object", properties: { document: { type: "string" }, pattern: { type: "string" }, limit: { type: "number" } }, required: ["document", "pattern"] },
    handler: async ({ document, pattern, limit }) => {
      for (const context of contexts) {
        const documents = await listDocuments(context.source.path);
        const found = documents.find((item) => item.name.toLowerCase() === String(document).toLowerCase());
        if (!found) continue;
        const text = await getDocumentText(context.source.path, found.name);
        const regex = new RegExp(pattern, "i");
        const lines = text.split("\n");
        const hits = [];
        lines.forEach((line, index) => {
          if (regex.test(line) && hits.length < (Number(limit) || 30)) hits.push(`${index + 1}: ${lines.slice(Math.max(0, index - 1), index + 2).join(" | ")}`);
        });
        return hits.length ? hits.join("\n") : "Sin coincidencias.";
      }
      return `Documento no encontrado: ${document}.`;
    },
  }));

  if (repos.length) {
    tools.push(await defineKddTool("list_repositories", {
      description: "Lista los repositorios locales seleccionados para el trabajo, con su ruta, rama y remoto.",
      parameters: { type: "object", properties: {} },
      handler: async () => repos.map((repo) => ({ name: repo.name, path: repo.path, branch: repo.branch, remote: repo.remote, stacks: repo.stacks })),
    }));

    tools.push(await defineKddTool("grep_repo", {
      description: "Busca un patrón (regex) en los ficheros de un repositorio seleccionado. Devuelve ruta:línea:texto.",
      parameters: { type: "object", properties: { repository: { type: "string", description: "Nombre del repositorio (ver list_repositories)" }, pattern: { type: "string" }, glob: { type: "string", description: "Filtro opcional de fichero, p. ej. *.java" }, limit: { type: "number" } }, required: ["repository", "pattern"] },
      handler: async ({ repository, pattern, glob, limit }) => {
        const repo = repos.find((item) => item.name.toLowerCase() === String(repository).toLowerCase());
        if (!repo) return `Repositorio no encontrado: ${repository}.`;
        const args = ["grep", "-n", "-I", "-E", "--", pattern];
        if (glob) args.push("--", glob);
        const result = await runCommand("git", args, { cwd: repo.path, timeoutMs: 30000 });
        const lines = (result.stdout || "").split("\n").filter(Boolean).slice(0, Number(limit) || 60);
        return lines.length ? lines.join("\n") : "Sin coincidencias.";
      },
    }));

    tools.push(await defineKddTool("read_repo_file", {
      description: "Lee un fichero de un repositorio seleccionado (ruta relativa a la raíz del repositorio).",
      parameters: { type: "object", properties: { repository: { type: "string" }, path: { type: "string" }, maxChars: { type: "number" } }, required: ["repository", "path"] },
      handler: async ({ repository, path: relative, maxChars }) => {
        const repo = repos.find((item) => item.name.toLowerCase() === String(repository).toLowerCase());
        if (!repo) return `Repositorio no encontrado: ${repository}.`;
        const target = path.resolve(repo.path, String(relative));
        if (!target.startsWith(path.resolve(repo.path))) return "Ruta fuera del repositorio.";
        const info = await stat(target).catch(() => null);
        if (!info) return `No existe ${relative}.`;
        if (info.isDirectory()) {
          const entries = await readdir(target, { withFileTypes: true });
          return entries.map((entry) => `${entry.isDirectory() ? "[d]" : "[f]"} ${entry.name}`).join("\n");
        }
        const text = await readFile(target, "utf8");
        const limit = Number(maxChars) || 20000;
        return text.length > limit ? `${text.slice(0, limit)}\n…(truncado)` : text;
      },
    }));

    tools.push(await defineKddTool("repo_tree", {
      description: "Estructura de carpetas y ficheros de un repositorio (hasta cierta profundidad), ignorando node_modules, target, build y .git.",
      parameters: { type: "object", properties: { repository: { type: "string" }, depth: { type: "number" }, subpath: { type: "string" } }, required: ["repository"] },
      handler: async ({ repository, depth, subpath }) => {
        const repo = repos.find((item) => item.name.toLowerCase() === String(repository).toLowerCase());
        if (!repo) return `Repositorio no encontrado: ${repository}.`;
        const lines = [];
        const ignore = new Set(["node_modules", ".git", "target", "build", "dist", ".gradle", ".idea", ".vscode", "__pycache__", ".next", "coverage"]);
        const walk = async (dir, level, prefix) => {
          if (level > (Number(depth) || 3) || lines.length > 600) return;
          let entries = [];
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (ignore.has(entry.name)) continue;
            lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`);
            if (entry.isDirectory()) await walk(path.join(dir, entry.name), level + 1, `${prefix}  `);
          }
        };
        await walk(path.resolve(repo.path, subpath || "."), 1, "");
        return lines.join("\n") || "(vacío)";
      },
    }));
  }

  return tools;
}

export function describeTools(tools) {
  return tools.map((tool) => `- \`${tool.name}\`: ${tool.description}`).join("\n");
}
