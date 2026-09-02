import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";

process.env.DORIATH_HOME = await mkdtemp(path.join(os.tmpdir(), "doriath-test-home-"));
const { loadConfig } = await import("../src/config.mjs");
await loadConfig();
const { parseSpecId, buildSpecId, allocateSpecId, extractSpecIds } = await import("../src/kdd/ids.mjs");
const { parseSpecMarkdown, serializeSpecMarkdown, bumpVersion } = await import("../src/kdd/frontmatter.mjs");
const { validateSpecStructure, countAcceptanceCriteria, findSection } = await import("../src/kdd/sections.mjs");
const { buildGraph, impact, validateGraph, activationBundle, detectCycles } = await import("../src/kdd/graph.mjs");
const { buildSpecIndex, tokenize } = await import("../src/kdd/search.mjs");
const { getSpecStore } = await import("../src/kdd/store.mjs");
const { createSource, addExistingSource, listSources } = await import("../src/knowledge/sources.mjs");

test("ids: parse, build, allocate", () => {
  assert.deepEqual(parseSpecId("DOM-REG-S001-002"), { id: "DOM-REG-S001-002", layer: "domain", prefix: "DOM", sourceId: "S001", domain: "REG", number: 2, numberText: "002" });
  assert.equal(parseSpecId("WRK-SPEC-S010-001").layer, "work-spec");
  assert.equal(parseSpecId("DOM-RISK-001").sourceId, null);
  assert.equal(parseSpecId("FOO-001"), null);
  assert.equal(buildSpecId({ layer: "feature", domain: "batch", sourceId: "s001", number: 7 }), "FEAT-BATCH-S001-007");
  assert.equal(allocateSpecId(["DOM-REG-S001-001", "DOM-REG-S001-003", "DOM-REG-S002-009"], { layer: "domain", domain: "REG", sourceId: "S001" }), "DOM-REG-S001-004");
  assert.deepEqual(extractSpecIds("ver ARCH-S001-001 y dom-risk-s001-002, no FOO-001"), ["ARCH-S001-001", "DOM-RISK-S001-002"]);
});

test("frontmatter: parse legacy fields and round-trip", () => {
  const text = `---\nid: dom-risk-s001-001\ntype: knowledge\nlayer: domain\ntitle: VaR\nstatus: active\nconfidence: medium\nversion: 1.2.0\nimplements: ARCH-S001-001\ndependencies:\n  - id: DOM-REG-S001-001\n    relation: constrained-by\ntags: [risk]\n---\n\n# DOM-RISK-S001-001 — VaR\n\n## Intent\n\nHola.\n`;
  const { spec, errors, warnings } = parseSpecMarkdown(text, { filePath: "x.md" });
  assert.equal(errors.length, 0);
  assert.equal(spec.id, "DOM-RISK-S001-001");
  assert.equal(spec.axis, "knowledge");
  assert.deepEqual(spec.dependencies, [{ id: "DOM-REG-S001-001", type: "constrained-by" }, { id: "ARCH-S001-001", type: "implements" }]);
  assert.ok(warnings.some((warning) => warning.includes("legacy")));
  const serialized = serializeSpecMarkdown(spec);
  const again = parseSpecMarkdown(serialized, { filePath: "y.md" }).spec;
  assert.equal(again.title, "VaR");
  assert.deepEqual(again.dependencies, spec.dependencies);
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
});

test("sections: canonical validation and acceptance criteria heuristics", () => {
  const good = { layer: "work-task", axis: "work", parent: "WRK-PLAN-S001-001", body: "## Objective\n\nHacer X.\n\n## Acceptance Criteria\n\n- [ ] Cuando llega un mensaje → responde HTTP 200 en menos de 500 ms\n" };
  assert.equal(validateSpecStructure(good).filter((issue) => issue.severity === "error").length, 0);
  const bad = { layer: "work-task", axis: "work", body: "## Objective\n\nHacer X.\n\n## Acceptance Criteria\n\n- Debe mejorar el rendimiento\n" };
  const issues = validateSpecStructure(bad);
  assert.ok(issues.some((issue) => issue.code === "missing-parent"));
  assert.ok(issues.some((issue) => issue.code === "unverifiable-acceptance-criteria"));
  assert.deepEqual(countAcceptanceCriteria("- valida el LEI\n- debe funcionar\n"), { total: 2, verifiable: 1 });
  assert.equal(findSection("## Intent\n\nA\n\n## Definition\n\nB", "Definition").content, "B");
});

test("graph: impact, cycles, activation bundle", () => {
  const specs = [
    { id: "DOM-A", layer: "domain", axis: "knowledge", status: "active", confidence: "high", title: "A", dependencies: [], activates: [], body: "## Intent\n\nA" },
    { id: "FEAT-B", layer: "feature", axis: "knowledge", status: "active", confidence: "low", title: "B", dependencies: [{ id: "DOM-A", type: "implements" }], activates: [], body: "## Intent\n\nB" },
    { id: "WRK-SPEC-C", layer: "work-spec", axis: "work", status: "draft", confidence: "low", title: "C", dependencies: [], activates: ["FEAT-B"], body: "" },
    { id: "ARCH-X", layer: "architecture", axis: "knowledge", status: "active", confidence: "medium", title: "X", dependencies: [{ id: "ARCH-Y", type: "extends" }], activates: [], body: "" },
    { id: "ARCH-Y", layer: "architecture", axis: "knowledge", status: "active", confidence: "medium", title: "Y", dependencies: [{ id: "ARCH-X", type: "extends" }, { id: "MISSING-1", type: "implements" }], activates: [], body: "" },
  ];
  const graph = buildGraph(specs);
  assert.deepEqual(impact(graph, "DOM-A").map((item) => item.id), ["FEAT-B", "WRK-SPEC-C"]);
  assert.equal(detectCycles(graph).length, 1);
  const issues = validateGraph(graph);
  assert.ok(issues.some((issue) => issue.code === "broken-reference"));
  const bundle = activationBundle(graph, { explicitIds: ["FEAT-B"], layer: "work-task" });
  assert.deepEqual([...bundle.tier1, ...bundle.tier2, ...bundle.tier3].map((item) => item.id).sort(), ["DOM-A", "FEAT-B"]);
});

test("search: bm25 ranks by vocabulary", () => {
  const index = buildSpecIndex([
    { id: "A", layer: "domain", axis: "knowledge", title: "Cálculo de VaR", status: "active", confidence: "low", tags: [], body: "simulación histórica 250 días" },
    { id: "B", layer: "feature", axis: "knowledge", title: "Onboarding de clientes", status: "active", confidence: "low", tags: [], body: "alta de cliente y KYC" },
  ]);
  assert.equal(index.search("var simulación")[0].id, "A");
  assert.equal(index.search("kyc cliente")[0].id, "B");
  assert.deepEqual(tokenize("El VaR de la cartera"), ["var", "cartera"]);
});

test("store and sources: create, persist, protect validated specs", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "doriath-kb-"));
  const source = await createSource({ name: "Caja test", parentDir: parent });
  assert.equal(source.sourceId, "S001");
  const store = await getSpecStore(source.path).load();
  const id = allocateSpecId(store.ids(), { layer: "domain", domain: "RISK", sourceId: source.sourceId });
  await store.create({ id, layer: "domain", axis: "knowledge", title: "VaR", dependencies: [], body: "## Intent\n\nA\n\n## Definition\n\nB larga larga larga larga larga larga larga.\n\n## Acceptance Criteria\n\n- [ ] Calcula el VaR\n" });
  assert.equal(store.get(id).version, "1.0.0");
  const first = await store.update(id, { body: "## Intent\n\nNuevo" }, { protectValidated: true });
  assert.equal(first.protected, false);
  await store.update(id, { confidence: "high" }, { bump: null });
  const second = await store.update(id, { body: "## Intent\n\nOtro" }, { protectValidated: true, evidenceNote: "propuesta" });
  assert.equal(second.protected, true);
  assert.ok(second.spec.body.includes("## Evidence"));
  assert.ok(second.spec.body.includes("Nuevo"));
  const again = await addExistingSource(source.path);
  assert.equal(again.created, false);
  assert.equal((await listSources()).length, 1);
});
