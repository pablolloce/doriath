# [KDD] Canonical 5-Step Workflow

> Canonical operational workflow for generating any KDD spec. Applies to ALL spec-generation prompts (analyze-document, create-spec-chat, resolution-chat, spec-activate, spec-consolidate, p037-generation, validation-correction).
>
> Source: `docs/kdd-reference/CLAUDE-spec-driven.md` — section "Working with this framework".

Every time you generate or update a spec, follow these 5 steps **in order**:

## Step 1 — Check the anatomy

Verify the body structure, section ordering, and frontmatter required fields against the **Spec Anatomy** reference already loaded in your context (bundle section: `[KDD Reference] KDD Spec Anatomy & Frontmatter Schema`).

Non-negotiables:
- Headers (Intent, Definition, Acceptance Criteria, Evidence, Traceability for Knowledge artifacts — or the layer-specific variants) **in English**.
- Narrative content **in Spanish** (the plugin's output language convention).
- Standard section order per layer — see the `Body structure by layer` section in the anatomy doc.
- The canonical worked example (DOM-RISK-001) at the bottom of the anatomy doc is your reference for tone + depth.

## Step 2 — Pick the correct spec type

Use the **Spec Types & Governance Cycle** reference (bundle section: `[KDD Reference] KDD Spec Types & Governance Cycle`) to select the type:

- **Knowledge artifacts** (persistent): ARCH, DOM, PROD, FEAT, DOC.
- **Work artifacts** (ephemeral): WRK-SPEC, WRK-PLAN, WRK-TASK.
- **Governance artifacts** (bridge): RFC (propose), ADR (decide), RULE (enforce).

Layer selection heuristic (canonical):
- Constrains many features → **ARCH**
- Owned by a domain expert → **DOM**
- Owned by a product owner → **PROD**
- Describes user-facing behavior → **FEAT**
- Explains how to do something → **DOC**

When ambiguous, prefer the layer that matches the **likely owner** of the knowledge.

## Step 3 — Apply the vertical taxonomy

If a vertical is declared in the project (setting `kddStudio.vertical`), its functional and technical domain tree has been injected in the bundle as `[KDD Reference] Vertical Taxonomy`. USE its vocabulary literally:

- Map `domain` + `subdomain` fields to nodes that exist in the vertical tree (don't invent new nodes).
- Inherit terminology: if the vertical defines "Markets & Trading / Risk Management / VaR", use exactly that — not a synonym or rewording.

If NO vertical is declared, fall back to the **Unified Taxonomy** (bundle section: `[KDD Reference] KDD Unified Taxonomy (3 axes)`) and use its generic classification.

## Step 4 — Frontmatter completeness

Every spec MUST ship with complete, valid YAML frontmatter per the schema in the anatomy doc:

### Required on ALL artifacts
`id`, `type`, `layer`, `status`, `version`, `owner`

### Knowledge-only
`confidence` (start at `low` for LLM-generated specs), `domain`, `subdomain` (if vertical applies).

### Work-only
`activates` (list of Knowledge spec IDs), `parent` (WRK-PLAN → WRK-SPEC, WRK-TASK → WRK-PLAN).

### Governance-only
- ADR: `status: proposed` initially; optional `supersedes` if replacing an earlier ADR.
- RFC: `status: draft` initially; may transition to `discussion` → `accepted` / `rejected` / `withdrawn`.
- RULE: `status: active` initially.

### Universally encouraged
`created` (ISO date), `updated` (ISO date), `reviewers`, `tags`, `dependencies` (list of `{id, relation}` pairs using the 8 canonical relation types).

**Never invent an ID in `dependencies` — reference only specs that exist in the provided inventory or that you create in the same output.**

## Step 5 — Self-validate integrity

Before emitting the final output, mentally run the equivalent of `spec-graph validate`:

- [ ] Every `dependencies[].id` points to a real spec in the inventory or a spec you're creating in this same output.
- [ ] No dependency cycles (A depends-on B, B depends-on A).
- [ ] Relation types match the layer-pair heuristic (FEAT → ARCH is `implements`; DOM regulatory → DOM is `constrained-by`; etc.).
- [ ] Frontmatter fields are complete per step 4.
- [ ] Confidence is at the correct level (default `low`; higher only if evidence explicitly supports testing + expert review).
- [ ] Status matches the artifact type's initial lifecycle value.
- [ ] IDs follow the canonical pattern (`TYPE-AREA-NNN` or `WRK-TYPE-NNN` or `ADR-NNN` / `RFC-NNN` / `RULE-NNN`).

If any check fails, FIX it in your output. Do not emit a spec you know has broken integrity.

> **Note**: the plugin will also run graph-level validation after persistence. Your self-validation catches issues before the file hits disk.

---

**Remember**: the 5 steps are a discipline, not a ceremony. They exist to make the LLM output **consistent with the canon** so two different runs on similar input produce compatible specs, and so the graph stays healthy as it grows.
