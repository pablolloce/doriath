# Specification Types & Governance

This document details every artifact type in the Knowledge-Driven Development framework: their purpose, structure, lifecycle, and how they relate through the governance cycle.

---

## The RFC → SPEC → ADR Governance Cycle

Three core artifact types cover the full knowledge lifecycle:

```
 RFC                    SPEC                   ADR
 (propose)      →      (formalize)     →      (decide & learn)
    ↑                                              │
    └──────────────── feedback loop ────────────────┘
```

| Artifact | Role | Trigger | Output |
|----------|------|---------|--------|
| **RFC** | Propose a change to standards, patterns, or processes | Need for change identified | Discussion → consensus |
| **SPEC** | Define the source of truth for a domain | RFC accepted, or initial knowledge capture | Formalized, versioned knowledge |
| **ADR** | Record a concrete decision taken during a project | Design decision needed | Context + rationale + consequences |

This cycle ensures knowledge is **proposed transparently**, **formalized rigorously**, and **recorded with full context**.

---

## The 5 SPEC Layers

Specifications are the central artifact. They are organized into five layers from strategic to operational.

### 1. Architecture Specs — `ARCH-NNN`

Define technology decisions, patterns, and infrastructure principles.

**Scope**: System-wide or cross-system concerns — how things are built.

**CIB Examples**:
- `ARCH-001` — Microservices Communication Patterns
- `ARCH-002` — Event-Driven Architecture for Trade Lifecycle
- `ARCH-003` — API Gateway Strategy for CIB Channels

**Structure**:
```
├── Context: problem being addressed
├── Decision: chosen approach
├── Rationale: why this approach
├── Consequences: trade-offs, implications
├── Patterns: related patterns
└── Confidence: HIGH|MEDIUM|LOW
```

### 2. Domain Specs — `DOM-AREA-NNN`

Capture business knowledge, rules, and regulatory requirements.

**Scope**: Business domain — what the system must know.

**CIB Examples**:
- `DOM-RISK-001` — Market Risk Calculation (VaR)
- `DOM-REG-001` — MiFID II Best Execution Requirements
- `DOM-CLM-001` — KYC/AML Onboarding Requirements
- `DOM-TRADE-001` — FX Spot Trade Lifecycle

**Structure**:
```
├── Definition: business concept
├── Rules: business rules that apply
├── Constraints: regulatory, compliance
├── Examples: concrete scenarios
└── Confidence: HIGH|MEDIUM|LOW
```

### 3. Product Specs — `PROD-JOURNEY-NNN`

Document product-level requirements and end-to-end user journeys.

**Scope**: User-facing flows — what the user experiences.

**CIB Examples**:
- `PROD-ONBOARD-001` — Corporate Client Onboarding
- `PROD-TRADE-001` — Order Execution Flow
- `PROD-SETTLE-001` — Post-Trade Settlement Journey

**Structure**:
```
├── Purpose: business goal
├── Actors: who participates
├── Flow: step-by-step journey
├── Acceptance criteria: testable criteria
└── Confidence: HIGH|MEDIUM|LOW
```

### 4. Feature Specs — `FEAT-MODULE-NNN`

Specify detailed functionality, screens, and behaviors.

**Scope**: Individual capabilities — what the code does.

**CIB Examples**:
- `FEAT-KYC-001` — Identity Verification
- `FEAT-KYC-002` — Document Upload & Validation
- `FEAT-RISK-001` — Real-Time Position Limit Check

**Structure**:
```
├── Purpose: what it does
├── Inputs: data/triggers
├── Behavior: logic, validations
├── Outputs: results, side effects
├── Evidence: screenshots, recordings
└── Confidence: HIGH|MEDIUM|LOW
```

### 5. Documentation Specs — `DOC-TYPE-NNN`

Reference materials, guides, and operational runbooks.

**Scope**: Supporting knowledge — how to operate and understand.

**CIB Examples**:
- `DOC-API-001` — Trading API Guide
- `DOC-OPS-001` — Deployment Runbook for Settlement Service
- `DOC-ARCH-001` — Architecture Overview for CIB Platform

**Structure**:
```
├── Purpose: why this document exists
├── Audience: who uses it
├── Content: key sections
├── Maintenance: update frequency, owner
└── Status: Draft|Active|Deprecated
```

---

## Supporting Artifact Types

### RFC (Request for Change)

**Purpose**: Propose changes to standards, patterns, or processes before formalizing them.

**Lifecycle**: `Draft → Discussion → Accepted | Rejected | Withdrawn`

**When to use**: Before creating or significantly modifying a SPEC. The RFC is the consensus mechanism.

**Key fields**:
- Problem statement
- Proposed solution
- Alternatives considered
- Impact assessment
- Discussion record

### ADR (Architecture Decision Record)

**Purpose**: Record a concrete decision taken during a project, with its context and rationale.

**Lifecycle**: `Proposed → Accepted → Deprecated | Superseded`

**When to use**: When a design decision is made that others need to understand in the future.

**Key fields**:
- Context (what prompted the decision)
- Decision (what was decided)
- Rationale (why)
- Consequences (trade-offs accepted)
- Related specs (which specs informed the decision)

### Guide

**Purpose**: Instruct teams on how to apply standards, use tools, or follow processes.

**Lifecycle**: `Draft → Published → Archived`

**When to use**: When teams need step-by-step instructions beyond what a SPEC defines.

### Template

**Purpose**: Accelerate creation of new artifacts by providing a starting structure.

**Lifecycle**: `Active → Deprecated`

**When to use**: When creating new specs, RFCs, or ADRs.

### Rule

**Purpose**: Codify constraints that can be automatically validated.

**Lifecycle**: `Active → Deprecated`

**Formats**: JSON Schema, OPA (Rego), CEL, or custom validators.

**When to use**: When a business rule or technical constraint should be enforced automatically in CI/CD.

---

## Confidence Levels

Every spec carries a confidence level that indicates how thoroughly it has been validated:

| Level | Meaning | Criteria |
|-------|---------|----------|
| **HIGH** | Confirmed and reliable | Validated by testing **AND** expert review |
| **MEDIUM** | Partially confirmed | Validated by testing **OR** expert review |
| **LOW** | Inferred, needs validation | Captured from observation or documentation, not yet validated |

Confidence levels drive governance:
- **HIGH** specs can be used for code generation and automated validation
- **MEDIUM** specs can guide development but require additional verification
- **LOW** specs should be prioritized for validation before being relied upon

---

## Spec Repository Structure

```
/specs
├── /architecture
│   ├── ARCH-001-microservices-patterns.md
│   ├── ARCH-002-event-driven-design.md
│   └── ARCH-003-api-gateway-strategy.md
├── /domain
│   ├── DOM-RISK-001-market-risk-calculation.md
│   ├── DOM-REG-001-mifid-best-execution.md
│   └── DOM-CLM-001-kyc-aml-requirements.md
├── /product
│   ├── PROD-ONBOARD-001-corporate-client-onboarding.md
│   └── PROD-TRADE-001-order-execution-flow.md
├── /feature
│   ├── FEAT-KYC-001-identity-verification.md
│   └── FEAT-RISK-001-position-limit-check.md
├── /documentation
│   ├── DOC-API-001-trading-api-guide.md
│   └── DOC-OPS-001-settlement-deployment-runbook.md
├── /rfcs
│   └── RFC-001-adopt-event-sourcing-for-trades.md
├── /adrs
│   └── ADR-001-kafka-for-trade-events.md
└── /rules
    └── trade-validation-rules.json
```

---

## BBVA ONE / NWorld Artifact Equivalences

For teams using the BBVA ONE framework, this table maps every NWorld and ONE artifact to its KDD equivalent. The goal is a single source of truth: NWorld artifacts become the traceability layer of KDD specs, not separate documents.

| NWorld / ONE Artifact | KDD Type | ID Pattern | Notes |
|-----------------------|----------|-----------|-------|
| **MSA** (Modelo Solution Architecture) | `spec` · layer `architecture` | `ARCH-SVC-NNN` | One ARCH-SVC per service/component. MSA sections map to KDD body: Context → Decision → Rationale → Consequences |
| **ARA** (Dictamen de Seguridad) | `rule` | `RULE-SEC-SVC-NNN` | Annexes the ARCH-SVC via `constrained-by`. Codified as JSON Schema or OPA rules for CI enforcement |
| **DT/P037** (Diseño Técnico) | Section `## Traceability` | inside `WRK-SPEC-NNN` | Not a standalone spec — lives as a traceability section linking design decisions, ADRs, and code paths |
| **C204** (Casos de uso de prueba) | Sections `## Acceptance Criteria` + `## Evidence` | inside `WRK-SPEC-NNN` / `WRK-TASK-NNN` | Test cases become acceptance criteria; test results become evidence entries |
| **Épica / MMF** | `spec` · layer `work-spec` | `WRK-SPEC-NNN` | `bbva_one.epic_jira_id` + `bbva_one.mmf: true` in frontmatter |
| **Feature** (Jira) | `spec` · layer `work-spec` | `WRK-SPEC-NNN` | `bbva_one.feature_jira_id` in frontmatter. Feature-scoped WRK-SPEC |
| **Historia de Usuario** (HU) | `spec` · layer `work-task` | `WRK-TASK-NNN` | `bbva_one.us_jira_id` in frontmatter. Each HU becomes one atomic WRK-TASK |
| **Backlog Item (RUN)** | `spec` · layer `work-task` | `WRK-TASK-NNN` | Tag `run` in frontmatter to distinguish from `change` |
| **Formulario de Categorización (FC)** | Field `bbva_one.continuum_tier` | in WRK-SPEC frontmatter | Tier 1–5 determines mandatory documentation and review gates |
| **Ficha de la Iniciativa** | `spec` · layer `product` | `PROD-JOURNEY-NNN` | Product-level intent, actors, acceptance. Persistent once the initiative becomes an organizational capability |
| **Workspace GlobalDevTools** | Field `bbva_one.workspace_id` | in all related specs | Foreign key to the GlobalDevTools instance |

### Mapping principle

> The NWorld artifact defines *what* must exist; the KDD spec defines *what it means*. Traceability flows from Jira/GlobalDevTools into KDD frontmatter — not the other way around.

When a new initiative is kicked off in GlobalDevTools:
1. Create a `WRK-SPEC` with `bbva_one.workspace_id` and `bbva_one.epic_jira_id`
2. For every Feature → create a child `WRK-SPEC` or `WRK-TASK` with `bbva_one.feature_jira_id`
3. For every HU → create a `WRK-TASK` with `bbva_one.us_jira_id`
4. The MSA produced in P0 → becomes `ARCH-SVC-NNN` (or updates an existing one)
5. The ARA → becomes `RULE-SEC-SVC-NNN`
6. On consolidation → decisions → ADRs, new patterns → ARCH specs, business rules → DOM specs

---

## Lifecycle Summary

```
         RFC                           SPEC                          ADR
  Draft ──→ Discussion          Draft ──→ Active             Proposed ──→ Accepted
        ──→ Accepted                 ──→ Deprecated                  ──→ Deprecated
        ──→ Rejected                                                 ──→ Superseded
        ──→ Withdrawn
```

All transitions are recorded in Git history. Status changes require a pull request with appropriate reviewers.

---

## Work Artifacts

Work Artifacts capture **what is being changed right now**. Unlike Knowledge Artifacts (persistent, organizational), Work Artifacts are **ephemeral** — tied to a specific initiative and archived when the work completes.

See [unified-taxonomy.md](unified-taxonomy.md) for the full three-axis architecture.

### Work Artifact Types

| Type | ID Pattern | Purpose | Parent |
|------|-----------|---------|--------|
| **WRK-SPEC** | `WRK-SPEC-NNN` | Define what needs to change and why | — |
| **WRK-PLAN** | `WRK-PLAN-NNN` | Define how the change will be implemented | WRK-SPEC |
| **WRK-TASK** | `WRK-TASK-NNN` | Atomic unit of implementation work | WRK-PLAN |

### Work Artifact Lifecycle

```
         WRK-SPEC / WRK-PLAN / WRK-TASK
  Draft ──→ Active ──→ Completed ──→ Archived
```

- **Draft**: being written, not yet actionable
- **Active**: approved and in progress
- **Completed**: work is done, acceptance criteria met
- **Archived**: retained for reference, no longer active

### The `activates` Relation

Work Artifacts reference Knowledge Artifacts via a new relation type: `activates`. This is the contextual activation mechanism — it declares which organizational knowledge informs the work.

| Relation | Direction | Meaning |
|----------|-----------|---------|
| `activates` | Work → Knowledge | "This work is informed by these Knowledge Artifacts" |
| `activated-by` | Knowledge → Work (inverse, auto-derived) | "This knowledge is being used in these Work streams" |

The `activates` relation is declared in the frontmatter as a list of spec IDs:

```yaml
activates:
  - DOM-RISK-001
  - ARCH-002
  - DOM-REG-001
```

### The `parent` Relation

Work Artifacts form a hierarchy via the `parent` field:

```
WRK-SPEC-001
  └── WRK-PLAN-001
        ├── WRK-TASK-001
        ├── WRK-TASK-002
        └── WRK-TASK-003
```

The parent field is a single spec ID declared in the frontmatter:

```yaml
parent: WRK-SPEC-001  # or WRK-PLAN-001 for tasks
```

### Knowledge Specs vs. Work Specs

| Aspect | Knowledge Specs | Work Specs |
|--------|----------------|------------|
| **Persistence** | Persistent — survive across projects | Ephemeral — tied to a specific change |
| **Scope** | Organizational knowledge | A single initiative or feature |
| **Lifecycle** | Draft → Active → Deprecated | Draft → Active → Completed → Archived |
| **Reuse** | Activated by multiple work streams | One-time use |
| **Layers** | architecture, domain, product, feature, documentation | work-spec, work-plan, work-task |
| **Key relation** | `dependencies` (to other knowledge) | `activates` (to knowledge) + `parent` (to work) |
