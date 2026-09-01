import test from "node:test";
import assert from "node:assert/strict";
import { parseModelYaml, extractYamlBlock, hasEndMarker, mergeContinuation } from "../src/ai/yaml-blocks.mjs";
import { splitNarrativeAndActions, buildPackagePreview } from "../src/work/packages.mjs";
import { splitDocumentSections, chunkText, normalizeText } from "../src/knowledge/extract.mjs";
import { renderTemplate } from "../src/ai/prompts.mjs";

test("yaml blocks: strips fences and prose, cuts at end marker", () => {
  const text = "Aquí va el plan.\n```yaml\nplan:\n  summary: \"hola\"\nspecs:\n  - id: DOM-S001-001\n    action: create\n#END_OF_PLAN\n```\ntexto posterior";
  const parsed = parseModelYaml(text, { startKey: "plan", endMarker: "#END_OF_PLAN" });
  assert.equal(parsed.plan.summary, "hola");
  assert.equal(parsed.specs[0].id, "DOM-S001-001");
  assert.ok(hasEndMarker(text, "#END_OF_PLAN"));
  assert.equal(extractYamlBlock("nada", { startKey: "plan" }), null);
  const merged = mergeContinuation("plan:\n  a: 1\nspecs:\n  - id: X", "```yaml\nplan:\n    body: y\n#END_OF_PLAN\n```");
  assert.ok(merged.includes("body: y"));
  assert.equal(merged.split("plan:").length, 2);
});

test("packages: narrative/actions split and preview validation", () => {
  const raw = `#CREATION_PHASE: generate\n#CREATION_SOURCE_ID: S001\n#REPOSITORIES: risk-engine, ninguno\nVamos con el paquete.\n\n#RESOLUTION_ACTIONS\nactions:\n  - action_type: propose_new_spec\n    spec:\n      id: "WRK-SPEC-001"\n      type: "work"\n      layer: "work-spec"\n      title: "Migrar VaR"\n      status: "draft"\n      confidence: "low"\n      activates: []\n      body: |\n        ## Problem Statement\n        Lento.\n        ## Proposed Change\n        Reescribir.\n        ## Acceptance Criteria\n        - [ ] El batch procesa 100K posiciones en menos de 60 min\n    reasoning: "raíz"\n  - action_type: propose_new_spec\n    spec:\n      id: "WRK-PLAN-001"\n      type: "work"\n      layer: "work-plan"\n      title: "Plan"\n      parent: "WRK-SPEC-001"\n      body: |\n        ## Approach\n        Kafka.\n        ## Task Breakdown\n        | Task | Desc |\n        |---|---|\n        | WRK-TASK-001 | consumer |\n  - action_type: propose_new_spec\n    spec:\n      id: "WRK-TASK-001"\n      type: "work"\n      layer: "work-task"\n      title: "Consumer"\n      parent: "WRK-PLAN-001"\n      task_kind: "implementation"\n      body: |\n        ## Objective\n        Implementar consumer.\n        ## Acceptance Criteria\n        - [ ] Cuando llega un mensaje válido → se persiste en menos de 500 ms\n`;
  const parsed = splitNarrativeAndActions(raw);
  assert.equal(parsed.phase, "generate");
  assert.equal(parsed.sourceId, "S001");
  assert.deepEqual(parsed.repositories, ["risk-engine"]);
  assert.equal(parsed.narrative, "Vamos con el paquete.");
  assert.equal(parsed.actions.length, 3);
  const store = { ids: () => [], get: () => null, byAxis: () => [], byLayer: () => [] };
  const pkg = buildPackagePreview(parsed.actions, { store, sourceId: "S001", kind: "work" });
  assert.deepEqual(pkg.specs.map((spec) => spec.id), ["WRK-SPEC-S001-001", "WRK-PLAN-S001-001", "WRK-TASK-S001-001"]);
  assert.equal(pkg.specs[1].parent, "WRK-SPEC-S001-001");
  assert.equal(pkg.specs[2].parent, "WRK-PLAN-S001-001");
  assert.equal(pkg.blocking, false);
  const lonelyPlan = buildPackagePreview(parsed.actions.slice(0, 2), { store, sourceId: "S001", kind: "work" });
  assert.equal(lonelyPlan.blocking, true);
  assert.ok(lonelyPlan.specs[1].issues.some((issue) => issue.code === "missing-task-breakdown"));
});

test("extract helpers: sections, chunking, normalization", () => {
  const sections = splitDocumentSections("# Título\n\nHola\n\n3.2 Limpieza de campos\n\ntexto\n\nCONTROL DE VERSIONES\n\nmás");
  assert.deepEqual(sections.map((section) => section.title), ["Título", "3.2 Limpieza de campos", "CONTROL DE VERSIONES"]);
  assert.equal(chunkText("a".repeat(130000), 60000).length, 3);
  assert.equal(normalizeText("a\r\nb\f\n\n\n\n\nc  "), "a\nb\n\n\nc");
});

test("prompts: placeholders", () => {
  assert.equal(renderTemplate("Hola {NOMBRE} y {OTRO}", { NOMBRE: "Ana" }), "Hola Ana y ");
});
