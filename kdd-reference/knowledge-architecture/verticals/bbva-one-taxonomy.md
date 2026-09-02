# BBVA ONE Vertical Taxonomy

> Extends the KDD three-axis architecture for teams operating within the BBVA ONE SDLC framework. The Work and Governance axes remain identical — this taxonomy defines the Knowledge Artifacts axis for BBVA CIB and the process overlay that ONE adds.

---

## What this taxonomy defines

1. **ONE Playbook → KDD Knowledge Artifact mapping** — which spec types are produced by each Playbook
2. **NWorld artifact → KDD spec type equivalences** — operational mapping for day-to-day teams
3. **Federated KB areas** — how the CIB knowledge base is distributed by domain area
4. **Activation matrix** — which Knowledge Artifacts are activated at each ONE phase
5. **ONE practice → RULE spec catalog** — ONE directives formalized as enforceable rules

---

## ONE Playbook → KDD Knowledge Artifact mapping

Each ONE Playbook phase produces specific types of knowledge. This table defines the mapping so teams know exactly which KDD artifacts to create or update as they execute each Playbook.

| ONE Playbook | Phase | Knowledge Artifacts produced | Governance Artifacts |
|-------------|-------|------------------------------|---------------------|
| **P0** — Análisis y Diseño | Architecture decision, security assessment | `ARCH-SVC-NNN` (MSA), `RULE-SEC-SVC-NNN` (ARA) | ADR (if key decisions made), RFC (if new pattern proposed) |
| **P1** — Gestión del Backlog | Product understanding, business rules | `PROD-JOURNEY-NNN` (if new journey), `DOM-*` (if new business rules discovered) | RFC (if backlog reveals standards gap) |
| **P2** — Desarrollo y Versionado | Feature behavior, domain rules, patterns | `FEAT-MODULE-NNN`, `DOM-AREA-NNN` (rule clarifications), `ARCH-NNN` (patterns proven) | ADR (design decisions), RULE (extracted business rules) |
| **P3** — Análisis de Código y Construcción | Quality standards, pipeline patterns | `RULE-QUALITY-NNN` (coverage, linting), `ARCH-PIPELINE-NNN` (CI patterns) | ADR (toolchain decisions) |
| **P4** — Testing | Test standards, acceptance criteria formalization | `RULE-TEST-NNN` (test type standards), `FEAT-*` updated with evidence | — |
| **P5** — Despliegue y Observabilidad | Operational knowledge, SLOs, runbooks | `ARCH-OPS-NNN` (deployment patterns), `DOC-RUNBOOK-NNN`, `RULE-DEPLOY-NNN` (Continuum tier requirements) | ADR (deployment strategy), RULE (SLO enforcement) |

### Key insight

> The Knowledge Base does not precede ONE — it is born by executing ONE. Every Playbook phase produces learning that is captured as a spec. The consolidation phase (KDD Pillar 2) is the mechanism that makes this explicit.

---

## NWorld Artifact → KDD Spec Equivalences (operational view)

Day-to-day mapping for teams using GlobalDevTools and Jira:

```
GlobalDevTools workspace created
  └── WRK-SPEC-NNN  [bbva_one.workspace_id: WS-xxxxx]
        │
        ├── Épica / MMF (Jira)
        │     └── WRK-SPEC-NNN  [bbva_one.epic_jira_id: PROJ-1234, mmf: true]
        │
        ├── Feature (Jira)
        │     └── WRK-SPEC-NNN  [bbva_one.feature_jira_id: PROJ-2345]
        │
        └── Historia de Usuario (Jira HU)
              └── WRK-TASK-NNN  [bbva_one.us_jira_id: PROJ-3456]

P0 produces:
  ├── ARCH-SVC-NNN   ← MSA (Modelo Solution Architecture)
  └── RULE-SEC-SVC-NNN ← ARA (Dictamen de Seguridad)
      [bbva_one.continuum_tier: 3]
      [bbva_one.one_playbook: P0]

DT/P037 (Diseño Técnico)
  └── Section ## Traceability in WRK-SPEC-NNN  ← not a standalone spec

C204 (Casos de uso de prueba)
  └── Section ## Acceptance Criteria + ## Evidence in WRK-SPEC / WRK-TASK
```

---

## Federated KB Areas (BBVA CIB)

The CIB knowledge base is distributed across areas aligned with ONE Service Ownership. Each area is an independent Git repo; the index repo federates them via submodules.

| `kb_area` slug | Domain coverage | Owning guild | Key spec patterns |
|---------------|----------------|-------------|------------------|
| `markets-trading` | Order management, execution, algo trading, market data | Markets & Trading Architecture | `DOM-MKTS-*`, `ARCH-TRADE-*`, `RULE-MIFID-*` |
| `risk` | Market risk (VaR), credit risk, counterparty risk | Risk Architecture | `DOM-RISK-*`, `ARCH-RISK-*`, `RULE-BASEL-*` |
| `regulatory` | MiFID II, DORA, AML/KYC, Basel IV, FATCA/CRS | Compliance Architecture | `DOM-REG-*`, `RULE-DORA-*`, `RULE-AML-*` |
| `investment-banking` | Deal management, DCM, M&A advisory | IB Architecture | `DOM-IB-*`, `PROD-DEAL-*` |
| `corporate-banking` | Lending, transaction banking, treasury, custody | CB Architecture | `DOM-CB-*`, `PROD-LEND-*` |
| `client-lifecycle` | KYC onboarding, client data, CRM | Client Lifecycle guild | `DOM-CLM-*`, `FEAT-KYC-*` |
| `platform` | Infrastructure patterns, CI/CD, observability, data | Platform Engineering | `ARCH-PLT-*`, `ARCH-PIPELINE-*`, `DOC-OPS-*` |
| `quality` | Testing standards, ONE Playbook P3/P4 directives | Engineering Excellence | `RULE-QUALITY-*`, `RULE-TEST-*`, `ARCH-PIPELINE-*` |

### Index repo structure

```
bbva-cib-kb-index/
  .gitmodules               ← submodule references to all area repos
  index.yaml                ← manifest: area slugs, repo URLs, owners
  governance/
    RULE-GLOBAL-*           ← cross-cutting rules (apply to all areas)
    ADR-GLOBAL-*            ← cross-cutting architecture decisions
```

---

## ONE Practice → RULE Spec Catalog

ONE's 647 directives include enforceable constraints. This section maps the most critical ones to RULE spec patterns for CI/CD automation.

### Playbook P2 — Development

| ONE Directive | RULE spec | Enforcement |
|--------------|-----------|-------------|
| Trunk-based development (commits to main ≥1/day) | `RULE-DEV-TRUNK-001` | Pipeline checks branch age |
| Pull Request review required (≥1 approval) | `RULE-DEV-PR-001` | Branch protection rule |
| No direct commits to main | `RULE-DEV-PR-002` | Branch protection rule |
| Commit message follows convention | `RULE-DEV-COMMIT-001` | Commit lint in CI |

### Playbook P3 — Code Analysis & Build

| ONE Directive | RULE spec | Enforcement |
|--------------|-----------|-------------|
| Code coverage ≥ 80% (Practitioner minimum) | `RULE-QUALITY-COVERAGE-001` | Coverage gate in pipeline |
| Static analysis: zero critical/high findings | `RULE-QUALITY-SAST-001` | SAST tool gate |
| Build reproducible (same input → same output) | `RULE-QUALITY-BUILD-001` | Pipeline validation |
| Dependency vulnerability scan (SCA) | `RULE-QUALITY-SCA-001` | SCA gate in pipeline |

### Playbook P4 — Testing

| ONE Directive | RULE spec | Enforcement |
|--------------|-----------|-------------|
| Unit tests required for all business logic | `RULE-TEST-UNIT-001` | Coverage gate |
| Integration tests required before merge | `RULE-TEST-INTEG-001` | Pipeline gate (integration stage) |
| Contract tests for all API dependencies | `RULE-TEST-CONTRACT-001` | Pact/contract tool gate |
| Performance baseline must not regress >10% | `RULE-TEST-PERF-001` | Performance test gate |

### Playbook P5 — Deployment

| ONE Directive | RULE spec | Enforcement |
|--------------|-----------|-------------|
| Tier 1–2: manual approval required | `RULE-DEPLOY-TIER-001` | Continuum pipeline gate |
| Tier 3–5: automatic deployment with rollback | `RULE-DEPLOY-TIER-002` | Continuum pipeline config |
| SLO defined for all production services | `RULE-OPS-SLO-001` | Validated against ARCH-OPS spec |
| Rollback procedure documented | `RULE-DEPLOY-ROLLBACK-001` | DOC-RUNBOOK required |
| Observability (logs + metrics + traces) | `RULE-OPS-OBSERVABILITY-001` | Checked in deployment checklist |

---

## Activation Matrix: ONE Phase × Knowledge

Which KDD Knowledge Artifacts are activated (injected as context) at each ONE SDLC phase:

| ONE Phase | Activate for context | Produce as output |
|-----------|---------------------|-------------------|
| **P0 — Análisis y Diseño** | `DOM-*` (business rules), `ARCH-*` (existing patterns), `RULE-SEC-*` (security constraints) | `ARCH-SVC-NNN`, `RULE-SEC-SVC-NNN` |
| **P1 — Backlog** | `DOM-*` (business context), `PROD-*` (product journeys) | `WRK-SPEC-NNN` (Épicas, Features) |
| **P2 — Desarrollo** | `FEAT-*` (behavior), `DOM-*` (business rules), `ARCH-*` (technical constraints), `RULE-*` (quality standards) | `WRK-TASK-NNN` (HU), ADRs, `FEAT-*` updates |
| **P3 — CI/Build** | `RULE-QUALITY-*`, `ARCH-PIPELINE-*` | `RULE-QUALITY-*` (new directives), `ARCH-PIPELINE-*` |
| **P4 — Testing** | `FEAT-*` (acceptance criteria), `RULE-TEST-*`, `DOM-*` (business rules = test cases) | Evidence entries in `FEAT-*` and `WRK-TASK-*` |
| **P5 — Deploy** | `ARCH-OPS-*`, `RULE-DEPLOY-*`, `DOC-RUNBOOK-*` | `DOC-RUNBOOK-NNN` updates, `ARCH-OPS-*` updates |
| **Consolidation** | — | ADRs, `DOM-*` updates, `ARCH-*` updates, new `RULE-*` |

---

## Worked Example: Feature delivery end-to-end

**Context**: New feature — Real-time position limit check for FX trading desk.

```
P0 — Architecture review
  → Activates: ARCH-002 (event-driven), DOM-RISK-001 (risk rules), RULE-MIFID-001
  → Produces: ARCH-SVC-042 (position check service design), RULE-SEC-SVC-042 (ARA)
  → bbva_one.one_playbook: P0, continuum_tier: 3

P1 — Backlog
  → Creates: WRK-SPEC-018 [epic_jira_id: TRADING-2891, feature_jira_id: TRADING-2901]
  → Activates: DOM-RISK-001, ARCH-SVC-042, PROD-TRADE-001
  → Produces: WRK-PLAN-018

P2 — Development (sprint 1)
  → Creates: WRK-TASK-045 [us_jira_id: TRADING-2910], WRK-TASK-046
  → Activates: FEAT-RISK-001, DOM-RISK-001, ARCH-002, RULE-QUALITY-COVERAGE-001
  → Code aligned to activated specs; coverage gate passes
  → Decision made: Redis for limit cache → ADR-028 created

P4 — Testing
  → C204 cases → Acceptance Criteria in WRK-TASK-045/046
  → RULE-TEST-CONTRACT-001 applied (position check API contract)

P5 — Deploy
  → Tier 3: auto deploy with rollback
  → DOC-RUNBOOK-011 updated

Consolidation
  → ADR-028 persisted (Redis for limit cache)
  → FEAT-RISK-001 updated: v1.1.0 (evidence: integration test pass)
  → RULE-RISK-LIMIT-001 created (new: cross-currency netting rule discovered)
  → DOM-RISK-001: confidence LOW → MEDIUM (new netting sub-rule validated)
```

---

## Extending this taxonomy

To add a new CIB area or adapt for another BBVA vertical (Retail, Insurance):

1. Define the `kb_area` slug and add it to `index.yaml`
2. Map the functional domain tree (business structure)
3. Identify the ONE practices that are most relevant (some verticals have different P5 requirements)
4. Create initial `RULE-*` specs for the most critical ONE directives in that area
5. Create `DOM-*` stubs at `confidence: low` for the key business concepts
6. Assign a Service Owner and review guild
