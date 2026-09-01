import { INVERSE_RELATIONS, KNOWLEDGE_LAYERS } from "./layout.mjs";
import { findSection } from "./sections.mjs";

/**
 * Grafo de conocimiento derivado de los frontmatters: aristas declaradas (dependencies, activates,
 * parent, supersedes) + inversas calculadas. Sin fichero central: se reconstruye desde las specs.
 */
export function buildGraph(specs) {
  const nodes = new Map(specs.map((spec) => [spec.id, spec]));
  const edges = [];
  const push = (from, to, type) => {
    if (!from || !to) return;
    edges.push({ from, to, type, inverse: INVERSE_RELATIONS[type] || `${type}-by`, broken: !nodes.has(to) });
  };
  for (const spec of specs) {
    for (const dep of spec.dependencies || []) push(spec.id, dep.id, dep.type);
    for (const target of spec.activates || []) push(spec.id, target, "activates");
    if (spec.parent) push(spec.id, spec.parent, "parent");
    if (spec.supersedes) push(spec.id, spec.supersedes, "supersedes");
  }
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
  }
  return { nodes, edges, outgoing, incoming };
}

export function graphStats(graph) {
  const byLayer = {};
  const byStatus = {};
  const byConfidence = {};
  for (const spec of graph.nodes.values()) {
    byLayer[spec.layer] = (byLayer[spec.layer] || 0) + 1;
    byStatus[spec.status] = (byStatus[spec.status] || 0) + 1;
    byConfidence[spec.confidence] = (byConfidence[spec.confidence] || 0) + 1;
  }
  return { specs: graph.nodes.size, relations: graph.edges.length, broken: graph.edges.filter((edge) => edge.broken).length, byLayer, byStatus, byConfidence };
}

/** Specs sin ninguna relación entrante ni saliente. */
export function orphans(graph) {
  return [...graph.nodes.keys()].filter((id) => !(graph.outgoing.get(id)?.length) && !(graph.incoming.get(id)?.length));
}

/** Impacto transitivo: qué specs dependen (directa o indirectamente) de la dada. */
export function impact(graph, id, { maxDepth = 6 } = {}) {
  const start = String(id || "").toUpperCase();
  const visited = new Map([[start, 0]]);
  const queue = [start];
  const result = [];
  while (queue.length) {
    const current = queue.shift();
    const depth = visited.get(current);
    if (depth >= maxDepth) continue;
    for (const edge of graph.incoming.get(current) || []) {
      if (visited.has(edge.from)) continue;
      visited.set(edge.from, depth + 1);
      queue.push(edge.from);
      result.push({ id: edge.from, via: edge.type, from: current, depth: depth + 1, spec: graph.nodes.get(edge.from) || null });
    }
  }
  return result;
}

export function detectCycles(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const edge of graph.outgoing.get(id) || []) {
      if (edge.type === "supersedes" || edge.broken) continue;
      const next = edge.to;
      if (state.get(next) === 1) {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      } else if (!state.get(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of graph.nodes.keys()) if (!state.get(id)) visit(id);
  return cycles;
}

export function validateGraph(graph) {
  const issues = [];
  for (const edge of graph.edges) {
    if (edge.broken) issues.push({ code: "broken-reference", severity: "error", id: edge.from, message: `${edge.from} referencia ${edge.to} (${edge.type}) y no existe.` });
  }
  for (const cycle of detectCycles(graph)) {
    issues.push({ code: "cycle", severity: "error", id: cycle[0], message: `Ciclo detectado: ${cycle.join(" -> ")}.` });
  }
  for (const spec of graph.nodes.values()) {
    if (spec.axis !== "work") continue;
    if (spec.layer !== "work-spec" && spec.parent && !graph.nodes.has(spec.parent)) {
      issues.push({ code: "missing-parent", severity: "error", id: spec.id, message: `${spec.id} apunta a un padre inexistente (${spec.parent}).` });
    }
  }
  return issues;
}

export function pathBetween(graph, from, to) {
  const start = String(from).toUpperCase();
  const goal = String(to).toUpperCase();
  const previous = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (current === goal) break;
    const neighbours = [
      ...(graph.outgoing.get(current) || []).map((edge) => edge.to),
      ...(graph.incoming.get(current) || []).map((edge) => edge.from),
    ];
    for (const next of neighbours) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(goal)) return [];
  const out = [];
  for (let cursor = goal; cursor; cursor = previous.get(cursor)) out.unshift(cursor);
  return out;
}

/** Datos listos para la vista de grafo (nodos + aristas explícitas). */
export function graphView(graph) {
  return {
    nodes: [...graph.nodes.values()].map((spec) => ({ id: spec.id, title: spec.title, layer: spec.layer, axis: spec.axis, status: spec.status, confidence: spec.confidence })),
    edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to, type: edge.type, broken: edge.broken })),
  };
}

const BUDGETS = { "work-task": 5, "work-plan": 7, "work-spec": 10, default: 8 };

/**
 * Pipeline de activación contextual (explicit -> transitive -> filtered -> budgeted). Devuelve las
 * specs de conocimiento a inyectar, por tiers (1 body completo, 2 intent + AC, 3 solo id).
 */
export function activationBundle(graph, { explicitIds = [], layer = "default", budget }) {
  const limit = budget || BUDGETS[layer] || BUDGETS.default;
  const scored = new Map();
  const consider = (id, distance, relation) => {
    const spec = graph.nodes.get(id);
    if (!spec || !KNOWLEDGE_LAYERS.includes(spec.layer) && spec.axis !== "governance") return;
    if (spec.status === "deprecated" && distance > 0) return;
    const confidenceScore = { high: 1, medium: 0.7, low: 0.4 }[spec.confidence] || 0.4;
    const relationScore = { "constrained-by": 0.9, implements: 0.8, extends: 0.7, "uses-data-from": 0.6, activates: 1, explicit: 1 }[relation] || 0.5;
    const score = (1 / (1 + distance)) * 0.6 + confidenceScore * 0.25 + relationScore * 0.15;
    const previous = scored.get(id);
    if (!previous || previous.score < score) scored.set(id, { id, distance, relation, score, spec });
  };
  const queue = [];
  for (const id of explicitIds) {
    const upper = String(id).toUpperCase();
    consider(upper, 0, "explicit");
    queue.push([upper, 0]);
  }
  const visited = new Set(explicitIds.map((id) => String(id).toUpperCase()));
  while (queue.length) {
    const [current, distance] = queue.shift();
    if (distance >= 2) continue;
    for (const edge of graph.outgoing.get(current) || []) {
      if (edge.broken || visited.has(edge.to) || edge.type === "supersedes" || edge.type === "parent") continue;
      visited.add(edge.to);
      consider(edge.to, distance + 1, edge.type);
      queue.push([edge.to, distance + 1]);
    }
  }
  const ranked = [...scored.values()].sort((a, b) => b.score - a.score);
  const selected = ranked.slice(0, limit);
  const tier1 = selected.slice(0, Math.max(1, Math.ceil(limit / 2)));
  const tier2 = selected.slice(tier1.length, Math.max(tier1.length, Math.ceil(limit * 0.8)));
  const tier3 = selected.slice(tier1.length + tier2.length);
  return {
    budget: limit,
    considered: ranked.length,
    tier1: tier1.map((item) => ({ ...item, spec: undefined, body: item.spec.body, title: item.spec.title, layer: item.spec.layer })),
    tier2: tier2.map((item) => ({ ...item, spec: undefined, title: item.spec.title, layer: item.spec.layer, intent: findSection(item.spec.body, "Intent")?.content || "", acceptance: findSection(item.spec.body, "Acceptance Criteria")?.content || "" })),
    tier3: tier3.map((item) => ({ id: item.id, title: item.spec.title, layer: item.spec.layer })),
  };
}

export function renderActivationBundle(bundle) {
  const parts = [];
  parts.push(`<!-- activation: budget=${bundle.budget} considered=${bundle.considered} tier1=${bundle.tier1.length} tier2=${bundle.tier2.length} tier3=${bundle.tier3.length} -->`);
  for (const item of bundle.tier1) parts.push(`### ${item.id} — ${item.title} (${item.layer})\n\n${item.body.trim()}`);
  for (const item of bundle.tier2) parts.push(`### ${item.id} — ${item.title} (${item.layer})\n\n**Intent**\n${item.intent}\n\n**Acceptance Criteria**\n${item.acceptance}`);
  if (bundle.tier3.length) parts.push(`Otras specs relacionadas (disponibles con read_spec): ${bundle.tier3.map((item) => `${item.id} (${item.title})`).join(", ")}`);
  return parts.join("\n\n");
}
