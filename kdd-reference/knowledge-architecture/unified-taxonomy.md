# Unified Taxonomy — Knowledge + Work + Governance

> Three orthogonal axes that cover the full lifecycle: what you know, what you do, and how you decide.

---

## The Three-Axis Architecture

Knowledge-Driven Development organizes all artifacts along three orthogonal axes:

```
                        ┌─────────────────────────────────┐
                        │       GOVERNANCE ARTIFACTS       │
                        │     RFC · ADR · RULE             │
                        │  (bridge between knowledge       │
                        │   and work — decisions & rules)  │
                        └──────────┬──────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
         ┌─────────▼─────────┐    │    ┌─────────▼─────────┐
         │ KNOWLEDGE ARTIFACTS│    │    │  WORK ARTIFACTS    │
         │   (persistent)    │    │    │   (ephemeral)      │
         │                   │    │    │                    │
         │ ARCH · DOM · PROD │◄───┘───►│ WRK-SPEC           │
         │ FEAT · DOC        │         │ WRK-PLAN           │
         │                   │ activates│ WRK-TASK           │
         │ What you know     │◄────────│ What you do        │
         └───────────────────┘         └────────────────────┘
```

### Why three axes?

| Axis | Purpose | Persistence | Example |
|------|---------|-------------|---------|
| **Knowledge** | Capture what the organization knows | **Persistent** — survives across projects | `DOM-RISK-001` — VaR calculation rules |
| **Work** | Track what is being changed right now | **Ephemeral** — tied to a specific change | `WRK-SPEC-001` — Redesign VaR engine |
| **Governance** | Bridge knowledge and work with decisions | **Mixed** — ADRs persist, RFCs close | `ADR-015` — Historical simulation over Monte Carlo |

The axes are **orthogonal**: a Work Artifact references Knowledge Artifacts (via `activates`) without duplicating them. Knowledge Artifacts exist independently of any particular change.

---

## Axis 1: Knowledge Artifacts (Persistent)

Knowledge Artifacts capture **what the organization knows**. They persist across projects and improve over time. This is the existing spec taxonomy:

| Layer | ID Pattern | Scope | Persistence |
|-------|-----------|-------|-------------|
| **Architecture** | `ARCH-NNN` | Technology decisions, patterns, infrastructure | Long-lived |
| **Domain** | `DOM-AREA-NNN` | Business knowledge, rules, regulations | Long-lived |
| **Product** | `PROD-JOURNEY-NNN` | Product requirements, user journeys | Long-lived |
| **Feature** | `FEAT-MODULE-NNN` | Specific functionality, behaviors | Medium-lived |
| **Documentation** | `DOC-TYPE-NNN` | Reference materials, guides, runbooks | Long-lived |

Knowledge Artifacts are the **stable foundation**. They grow through the Evolutive cycle (Pillar 2) and are activated as context for Work Artifacts.

See [spec-types.md](spec-types.md) for full details on each layer.

---

## Axis 2: Work Artifacts (Ephemeral)

Work Artifacts capture **what is being changed right now**. They are tied to a specific initiative, feature, or bug fix. They have a bounded lifecycle: once the work is done, the artifact is completed and archived.

### WRK-SPEC — Work Specification

**Purpose**: Define **what** needs to change and **why**, with enough precision for planning and implementation.

| Field | Description |
|-------|-------------|
| **ID Pattern** | `WRK-SPEC-NNN` |
| **Layer** | `work-spec` |
| **Scope** | `ephemeral` |
| **Lifecycle** | `draft → active → completed → archived` |
| **Key relation** | `activates` Knowledge Artifacts as context |

**Standard sections**:
- **Problem Statement** — What's wrong or missing
- **Proposed Change** — What will be different
- **Knowledge Context** — Which Knowledge Artifacts inform this change (via `activates`)
- **Constraints** — Boundaries, non-goals, regulatory requirements
- **Acceptance Criteria** — Testable conditions for "done"
- **Open Questions** — Unknowns to resolve during planning

### WRK-PLAN — Work Plan

**Purpose**: Define **how** the change will be implemented — the technical approach, sequence, and task breakdown.

| Field | Description |
|-------|-------------|
| **ID Pattern** | `WRK-PLAN-NNN` |
| **Layer** | `work-plan` |
| **Scope** | `ephemeral` |
| **Lifecycle** | `draft → active → completed → archived` |
| **Key relation** | `parent` links to the WRK-SPEC |

**Standard sections**:
- **Approach** — Technical strategy and key decisions
- **Task Breakdown** — Ordered list of implementation tasks
- **Architecture Impact** — What architectural constraints apply (from activated ARCH specs)
- **Risk Assessment** — What could go wrong, mitigation strategies
- **Dependencies** — External dependencies, blocking items

### WRK-TASK — Work Task

**Purpose**: Define a single, atomic unit of implementation work. Independently implementable and testable.

| Field | Description |
|-------|-------------|
| **ID Pattern** | `WRK-TASK-NNN` |
| **Layer** | `work-task` |
| **Scope** | `ephemeral` |
| **Lifecycle** | `draft → active → completed → archived` |
| **Key relation** | `parent` links to the WRK-PLAN |

**Standard sections**:
- **Objective** — What this task produces
- **Implementation Notes** — Technical guidance, patterns to follow
- **Acceptance Criteria** — Task-level "done" conditions
- **Test Plan** — How to verify the task is correct

---

## Axis 3: Governance Artifacts (Bridge)

Governance Artifacts **bridge** Knowledge and Work. They are the mechanism by which decisions are proposed, recorded, and enforced.

| Type | Role | Persistence | Triggered by |
|------|------|-------------|-------------|
| **RFC** | Propose a change to standards or patterns | Ephemeral (closes after decision) | Need for change identified |
| **ADR** | Record a decision with context and rationale | Persistent (reference) | Design decision made |
| **RULE** | Codify constraints for automated validation | Persistent (enforced) | Business rule or standard formalized |

Governance Artifacts connect the axes:
- An **RFC** may be triggered by work (a WRK-SPEC reveals a gap in standards) or by knowledge evolution
- An **ADR** records a decision made during work that enriches the knowledge base
- A **RULE** automates constraints from Knowledge Artifacts for use during work execution

---

## The Integrated Flow

The full lifecycle flows through all three axes:

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                                                                 │
  │   1. SPECIFY          2. PLAN           3. IMPLEMENT            │
  │   ┌──────────┐       ┌──────────┐       ┌──────────┐           │
  │   │ WRK-SPEC │──────►│ WRK-PLAN │──────►│ WRK-TASK │──► Code   │
  │   └────┬─────┘       └────┬─────┘       └────┬─────┘           │
  │        │                  │                   │                  │
  │        │ activates        │ inherits          │ follows          │
  │        ▼                  ▼                   ▼                  │
  │   ┌─────────────────────────────────────────────────┐           │
  │   │          KNOWLEDGE ARTIFACTS                     │           │
  │   │   DOM-RISK-001  ARCH-002  FEAT-RISK-001  ...    │           │
  │   └─────────────────────────────────────────────────┘           │
  │                                                                 │
  │   4. CONSOLIDATE                                                │
  │   ┌──────────────────────────────────────┐                      │
  │   │ Work learnings → Knowledge updates   │                      │
  │   │ New ADRs · Updated specs · New rules │                      │
  │   └──────────────────────────────────────┘                      │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘
```

### Phase 1: Specify (WRK-SPEC)

The specification phase defines the change:
1. Identify what needs to change and why
2. **Activate** relevant Knowledge Artifacts as context (domain rules, architecture patterns, regulatory constraints)
3. Define acceptance criteria grounded in activated knowledge
4. Surface open questions and constraints

### Phase 2: Plan (WRK-PLAN)

The planning phase designs the implementation:
1. Create a WRK-PLAN with `parent: WRK-SPEC-NNN`
2. Inherit constraints from activated Knowledge Artifacts
3. Break work into atomic WRK-TASKs
4. Assess risk and dependencies

### Phase 3: Implement (WRK-TASK → Code)

The implementation phase executes:
1. Each WRK-TASK is independently implementable and testable
2. Implementation follows patterns from activated ARCH specs
3. Business logic follows rules from activated DOM specs
4. Acceptance criteria derive from both WRK-TASK and parent WRK-SPEC

### Phase 4: Consolidate (Work → Knowledge)

The consolidation phase closes the loop — it is the mechanism that makes the Evolutive pillar (Pillar 2) concrete. Without it, the knowledge base stagnates; with it, every project compounds organizational capability.

#### Consolidation triggers

Not every piece of work produces new knowledge. Consolidation is triggered by specific signals during the work lifecycle:

| Trigger | What happened | Consolidation action |
|---------|--------------|---------------------|
| **Decision made** | A design choice was debated and resolved during WRK-PLAN | Create ADR with context, alternatives, and rationale |
| **Rule clarified** | Implementation revealed an ambiguous business rule | Update the DOM spec with the clarified rule + evidence |
| **Pattern proven** | A new technical pattern was introduced and validated | Create or update ARCH spec with the pattern |
| **Constraint discovered** | A regulatory or technical constraint was found during implementation | Update the constraining DOM or ARCH spec |
| **Gap identified** | No spec existed for knowledge that was needed | Create a new Knowledge Artifact (likely at LOW confidence) |
| **Spec contradicted** | Implementation revealed that an existing spec was wrong or outdated | Update the spec + record the correction in an ADR |

#### Consolidation checklist

When a WRK-SPEC moves to `completed`, the team runs through:

1. **ADR review**: Were any design decisions made that aren't recorded? → Create ADRs
2. **Spec delta**: Did any activated Knowledge Artifacts need corrections during work? → Update specs, bump version
3. **New knowledge**: Was domain knowledge discovered that didn't exist as a spec? → Create new specs at LOW/MEDIUM confidence
4. **Rule extraction**: Were business rules hardcoded in implementation that should be formalized? → Create or update DOM specs
5. **Pattern capture**: Did the team introduce a reusable pattern? → Create or update ARCH specs
6. **Confidence upgrade**: Did implementation validate a LOW/MEDIUM confidence spec? → Upgrade confidence with evidence

#### What consolidation produces

```
WRK-SPEC-001 (completed)
  ├── ADR-016: Chose Redis over Memcached for scenario cache
  ├── DOM-RISK-001 v1.3.0: Clarified netting rule for multi-leg trades
  ├── ARCH-005 (new): Partitioned calculation pattern
  └── DOM-DATA-001 v2.1.0: Added market data correction event spec
```

The key insight: **consolidation is not optional maintenance — it is the primary mechanism by which the organization learns**. A project that ships code but doesn't consolidate knowledge has delivered only half its value.

---

## Contextual Activation

The `activates` relation is the key mechanism connecting Work to Knowledge:

```yaml
# In a WRK-SPEC frontmatter
activates:
  - DOM-RISK-001    # VaR calculation rules — domain context
  - ARCH-002        # Event-driven architecture — technical constraints
  - DOM-REG-001     # MiFID II requirements — regulatory constraints
```

When a WRK-SPEC activates Knowledge Artifacts, those artifacts become the **context bundle** for all downstream work:

- The **WRK-PLAN** inherits the activated context and adds technical specifics
- Each **WRK-TASK** receives the relevant subset of activated knowledge
- **AI agents** use the activated context to generate aligned code, tests, and documentation

This is not just linking — it's **scoped injection of organizational knowledge** into the work stream.

### How Activation Works

Activation is a multi-step process that combines explicit declaration, graph traversal, and relevance filtering:

```
  WRK-SPEC (input)
      │
      ▼
  ┌────────────────────┐
  │ 1. EXPLICIT         │  Author declares `activates: [DOM-RISK-001, ARCH-002, ...]`
  │    (declared)       │  These are the known-relevant specs.
  └────────┬───────────┘
           ▼
  ┌────────────────────┐
  │ 2. TRANSITIVE       │  Graph traversal (BFS) expands the activation set:
  │    (derived)        │  DOM-RISK-001 → constrained-by → DOM-REG-001 (pulled in)
  │                     │  ARCH-002 → implements → ARCH-001 (pulled in)
  └────────┬───────────┘
           ▼
  ┌────────────────────┐
  │ 3. FILTERED         │  Relevance scoring reduces noise:
  │    (prioritized)    │  - Graph distance from declared specs (closer = more relevant)
  │                     │  - Confidence level (HIGH specs rank above LOW)
  │                     │  - Layer alignment (DOM specs rank higher for a domain task)
  └────────┬───────────┘
           ▼
  ┌────────────────────┐
  │ 4. BUDGETED         │  Context window budget limits total output:
  │    (bounded)        │  - Tier 1 (full content): declared specs + depth-1 neighbors
  │                     │  - Tier 2 (summary): depth-2 neighbors, lower confidence
  │                     │  - Tier 3 (reference): IDs only, available on demand
  └────────────────────┘
```

**Step 1 — Explicit activation** is what the WRK-SPEC author declares. This is the human judgment call: "these are the specs I know are relevant." The `activates` field in frontmatter captures this.

**Step 2 — Transitive expansion** uses the knowledge graph to pull in specs that the declared specs depend on. The `spec-graph context` command already implements this as BFS with configurable depth. This catches knowledge the author may not have been aware of (e.g., a regulatory constraint that applies transitively).

**Step 3 — Relevance filtering** is where noise management happens. Not all transitively-reached specs are equally important. The scoring model considers:

| Signal | Weight | Rationale |
|--------|--------|-----------|
| Graph distance from declared specs | High | Closer = more directly relevant |
| Confidence level | Medium | HIGH confidence specs are more reliable context |
| Layer match | Medium | A domain task benefits more from DOM specs than DOC specs |
| Relation type | Low | `constrained-by` is stronger context than `extends` |
| Status = active | Filter | Deprecated specs are excluded unless explicitly activated |

**Step 4 — Context budgeting** ensures the activation bundle doesn't overwhelm the consumer (human or AI). The tiered approach:

- **Tier 1** (full content read): The declared specs and their immediate neighbors. These are read in full and injected as context.
- **Tier 2** (summary): Specs at depth 2+. Only the Intent section and Acceptance Criteria are included.
- **Tier 3** (reference list): Specs beyond the budget. Listed as IDs with titles — available on demand but not pre-loaded.

This tiered model adapts to context window size: a human developer might want Tier 1 only; an AI agent with a 200K context window can absorb Tiers 1+2.

### Current Tooling vs. Full Activation

| Capability | `spec-graph context` (current) | Full activation (target) |
|-----------|-------------------------------|------------------------|
| Explicit activation | Yes (`activates` field parsed) | Yes |
| Transitive expansion (BFS) | Yes (configurable `--depth`) | Yes |
| Relevance scoring | No (all neighbors treated equally) | Weighted scoring model |
| Context budgeting (tiers) | No (flat output) | Tiered output with summaries |
| AI-native output format | Partial (markdown) | Structured context bundle (JSON + markdown) |

The current `spec-graph context` command is a functional first step. The scoring and budgeting layers are the next evolution — they can be added incrementally without changing the underlying graph model.

### Activation vs. Dependencies

| Concept | Direction | Meaning |
|---------|-----------|---------|
| `dependencies` | Knowledge → Knowledge | Structural relationship between persistent artifacts |
| `activates` | Work → Knowledge | Contextual injection of knowledge into a work stream |
| `parent` | Work → Work | Hierarchical relationship (WRK-TASK → WRK-PLAN → WRK-SPEC) |

---

## Artifact Map: Types × Axes

Consolidated view of every artifact type, its axis, persistence, and primary relations.

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │                     KNOWLEDGE (persistent)                          │
 │                                                                      │
 │  ARCH-NNN ──── architecture decisions, patterns, infrastructure      │
 │  DOM-AREA-NNN  business rules, regulations, domain concepts          │
 │  PROD-JRN-NNN  product requirements, user journeys                  │
 │  FEAT-MOD-NNN  specific functionality, behaviors                     │
 │  DOC-TYPE-NNN  guides, runbooks, reference materials                 │
 │                                                                      │
 ├──────────────────────────────────────────────────────────────────────┤
 │                     WORK (ephemeral)                                 │
 │                                                                      │
 │  WRK-SPEC-NNN ─── what & why (activates knowledge)                  │
 │    └─ WRK-PLAN-NNN ── how (inherits constraints)                    │
 │         ├─ WRK-TASK-NNN ── do (atomic, testable)                    │
 │         └─ WRK-TASK-NNN                                             │
 │                                                                      │
 ├──────────────────────────────────────────────────────────────────────┤
 │                     GOVERNANCE (bridge)                              │
 │                                                                      │
 │  RFC-NNN ──── propose changes to standards                           │
 │  ADR-NNN ──── record decisions with rationale                        │
 │  RULE ─────── codify constraints for automation                      │
 │                                                                      │
 └──────────────────────────────────────────────────────────────────────┘
```

### Cross-reference: artifact type × properties

| Artifact | Axis | Layer | Persistence | Lifecycle | Key Relations |
|----------|------|-------|-------------|-----------|---------------|
| `ARCH-NNN` | Knowledge | architecture | Persistent | Draft → Active → Deprecated | `implements`, `constrained-by` |
| `DOM-AREA-NNN` | Knowledge | domain | Persistent | Draft → Active → Deprecated | `constrained-by`, `uses-data-from` |
| `PROD-JRN-NNN` | Knowledge | product | Persistent | Draft → Active → Deprecated | `extends`, `implements` |
| `FEAT-MOD-NNN` | Knowledge | feature | Persistent | Draft → Active → Deprecated | `implements`, `extends` |
| `DOC-TYPE-NNN` | Knowledge | documentation | Persistent | Draft → Active → Deprecated | `extends` |
| `WRK-SPEC-NNN` | Work | work-spec | Ephemeral | Draft → Active → Completed → Archived | `activates` (→ Knowledge) |
| `WRK-PLAN-NNN` | Work | work-plan | Ephemeral | Draft → Active → Completed → Archived | `parent` (→ WRK-SPEC) |
| `WRK-TASK-NNN` | Work | work-task | Ephemeral | Draft → Active → Completed → Archived | `parent` (→ WRK-PLAN), `depends-on` |
| `RFC-NNN` | Governance | — | Ephemeral | Draft → Discussion → Accepted / Rejected | triggers SPECs |
| `ADR-NNN` | Governance | — | Persistent | Proposed → Accepted → Superseded | records decisions from Work |
| `RULE` | Governance | — | Persistent | Active → Deprecated | enforces Knowledge constraints |

### Relation types across axes

| Relation | Direction | Crosses axes? | Purpose |
|----------|-----------|---------------|---------|
| `implements` | Knowledge → Knowledge | No | Applies a pattern defined elsewhere |
| `constrained-by` | Knowledge → Knowledge | No | Must comply with external rules |
| `extends` | Knowledge → Knowledge | No | Adds detail to a broader spec |
| `uses-data-from` | Knowledge → Knowledge | No | Consumes data from another spec |
| `activates` | Work → Knowledge | **Yes** | Injects knowledge as context into work |
| `depends-on` | Work → Work | No | Sequencing between work artifacts |
| `parent` | Work → Work | No | Hierarchy (Task → Plan → Spec) |
| `supersedes` | Any → Any | No | Replacement chain |

---

## Activation Matrix: Work Phase × Knowledge

Work Artifacts activate different Knowledge Artifacts at each phase of the flow:

| Work Phase | Work Artifact | Knowledge Activated | Governance Produced |
|-----------|--------------|--------------------|--------------------|
| **Specify** | WRK-SPEC | DOM specs, PROD specs, regulatory rules | RFCs (if standards gap found) |
| **Plan** | WRK-PLAN | ARCH specs, NFRs, API standards | ADRs (design decisions) |
| **Implement** | WRK-TASK | FEAT specs, business rules, testing standards | — |
| **Consolidate** | — | — | ADRs, updated DOM/ARCH specs, new RULEs |

---

## Federated Knowledge Base Model

For large organizations with multiple independent engineering areas (e.g., BBVA CIB), a single monolithic KB repo does not scale. The federated model distributes Knowledge Artifacts across per-area repos, tied together by an index.

### Structure

```
bbva-kb-markets-trading/     ← Service Owners: Markets & Trading guild
  specs/
    architecture/  ARCH-TRADE-*, ARCH-ALGO-*
    domain/        DOM-MKTS-*, DOM-EXEC-*
    rules/         RULE-MIFID-*, RULE-EXEC-*

bbva-kb-risk/                ← Service Owners: Risk Architecture guild
  specs/
    domain/        DOM-RISK-*, DOM-CCRISK-*
    rules/         RULE-BASEL-*, RULE-VAR-*

bbva-kb-regulatory/          ← Service Owners: Compliance guild
  specs/
    domain/        DOM-REG-*, DOM-AML-*
    rules/         RULE-DORA-*, RULE-FATCA-*

bbva-kb-platform/            ← Service Owners: Platform Engineering
  specs/
    architecture/  ARCH-PLT-*, ARCH-PIPELINE-*
    documentation/ DOC-OPS-*, DOC-RUNBOOK-*

bbva-cib-kb-index/           ← Federated index (git submodules)
  .gitmodules                  references all area repos
  index.yaml                   machine-readable manifest
```

### The `kb_area` field

Every spec in a federated KB declares its area via `bbva_one.kb_area` in the frontmatter. This field is the router: it identifies which area repo owns the spec and is used by the `spec-graph` CLI when resolving cross-repo dependencies.

```yaml
bbva_one:
  kb_area: markets-trading   # maps to bbva-kb-markets-trading/
```

Valid `kb_area` values are defined in the index manifest (`index.yaml`) of the federated index repo.

### Cross-repo dependencies

A spec in `bbva-kb-risk/` can declare a dependency on a spec in `bbva-kb-regulatory/`:

```yaml
dependencies:
  - id: DOM-REG-001          # lives in bbva-kb-regulatory/
    relation: constrained-by
```

The `spec-graph` CLI resolves cross-repo IDs when the federated index is available (via `--specs` pointing to the index with submodules initialized). Single-repo setups work without any changes — the federated layer is additive.

### Governance in a federated model

Each area repo has its own:
- **Service Owner (SO)** — accountable for knowledge quality in that area
- **Review gates** — PRs require area-owner approval for Knowledge Artifact changes
- **Confidence lifecycle** — area guild owns confidence upgrades (LOW → HIGH)

The federated index repo has a global governance layer for cross-cutting RULEs and ADRs that span multiple areas.

---

## Extending to Other Verticals

The three-axis architecture is universal. The Knowledge Artifacts axis is where verticals differ — each industry has its own functional domain tree, business rules, and regulatory landscape. The Work and Governance axes remain identical.

To add a new vertical:

1. **Define the functional domain tree** — the business structure specific to the industry (see [CIB example](../examples/verticals/cib-taxonomy.md))
2. **Map business rules** specific to that vertical
3. **Identify regulatory requirements** (vertical-specific)
4. **Reuse the technical domain** (mostly shared across verticals)
5. **Adapt the activation matrix** (different verticals may weight phases differently)

Planned extensions:
- **Retail Banking** — Channels, products (deposits, cards, loans), customer journeys
- **Insurance** — Underwriting, claims, actuarial, distribution
- **Telco** — Network, BSS/OSS, customer management, billing
- **Utilities** — Grid management, metering, billing, regulatory compliance

---

## Differential Advantages

### vs. GitHub Spec Kit (workflow without taxonomy)

GitHub Spec Kit provides a clean Specify → Plan → Tasks → Implement flow. But specs are generic documents — there's no taxonomy of **what kind** of knowledge informs the specification, and no mechanism for **organizational reuse**.

| Capability | GitHub Spec Kit | Unified Taxonomy |
|-----------|----------------|-----------------|
| Spec → Plan → Tasks flow | Yes | Yes (Work Artifacts axis) |
| Domain knowledge taxonomy | No | Yes (Knowledge Artifacts axis) |
| Contextual activation | No | Yes (`activates` relation) |
| Knowledge reuse across projects | No | Yes (persistent Knowledge Artifacts) |
| Governance cycle | No | Yes (Governance Artifacts axis) |
| Confidence levels | No | Yes (per Knowledge Artifact) |

### vs. Vibe Coding (no rigor)

Vibe coding produces working code fast but creates black boxes. The unified taxonomy preserves speed (AI agents operate on Work Artifacts) while embedding organizational knowledge and governance.

| Capability | Vibe Coding | Unified Taxonomy |
|-----------|------------|-----------------|
| Speed to working code | Very fast | Fast (agents + structured context) |
| Traceability | None | Full (spec → code → test) |
| Regulatory compliance | None | Built-in (governance axis) |
| Knowledge accumulation | None | Systematic (consolidation phase) |
| Maintainability | Low | High (specs survive code changes) |

### vs. Waterfall Specifications (no agility)

Traditional spec approaches are heavyweight and disconnected from implementation. Work Artifacts are **lightweight and ephemeral** — they live alongside code and close when the work is done.

| Capability | Waterfall Specs | Unified Taxonomy |
|-----------|----------------|-----------------|
| Spec freshness | Stale by implementation | Living (co-evolves with code) |
| Overhead | Heavy (BDUF) | Light (Work Artifacts are minimal) |
| Feedback loop | Slow (phases are sequential) | Fast (consolidate feeds back to knowledge) |
| AI integration | None | Native (agents operate on all axes) |

---

## The Knowledge-Work Duality

The fundamental insight of the unified taxonomy is the **duality between knowledge and work**:

- **Knowledge without work** is a static library — valuable but underutilized
- **Work without knowledge** is ad-hoc development — fast but fragile
- **Knowledge activated by work** is a development accelerator — fast, aligned, and accumulating

The three axes formalize this duality:

```
Knowledge (what you know)  ←──activates──  Work (what you do)
         │                                        │
         └────── governed by ──► Governance ◄──────┘
```

Every project doesn't just deliver software — it delivers **knowledge that makes the next project better**. This is the compounding advantage that no pure-workflow approach can match.

### The Compounding Loop

The three mechanisms — activation, execution, and consolidation — form a flywheel:

```
         ┌─────────────────────────────────────────────────┐
         │                                                 │
         ▼                                                 │
   KNOWLEDGE BASE                                          │
   (grows over time)                                       │
         │                                                 │
         │  activated by                                   │
         ▼                                                 │
   WORK STREAM                                             │
   (WRK-SPEC → WRK-PLAN → WRK-TASK → Code)                │
         │                                                 │
         │  consolidates into                              │
         ▼                                                 │
   NEW KNOWLEDGE                                           │
   (ADRs, updated specs, new rules) ───────────────────────┘
```

- **Cycle 1**: Small knowledge base → activation pulls in few specs → work proceeds with limited context → consolidation adds first ADRs and spec corrections
- **Cycle N**: Rich knowledge base → activation pulls precise, high-confidence context → work is faster and better aligned → consolidation refines and extends the knowledge base

The marginal cost of each cycle decreases (less discovery needed) while the marginal value increases (better context, fewer mistakes). This is the structural advantage of treating knowledge as a persistent, governed organizational asset.
