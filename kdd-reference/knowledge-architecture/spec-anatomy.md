# Spec Anatomy — Standard Structure

Every specification in the framework follows a standard structure. This document defines the anatomy of a spec, the required YAML frontmatter, and provides a concrete example.

---

## YAML Frontmatter

Every spec begins with a YAML frontmatter block that enables machine parsing, indexing, and governance automation.

```yaml
---
id: DOM-RISK-001
type: spec
layer: domain                    # architecture | domain | product | feature | documentation
domain: Markets & Trading        # functional domain from taxonomy
subdomain: Risk Management       # subdomain from taxonomy
status: active                   # draft | active | deprecated
confidence: high                 # high | medium | low
version: 1.2.0                  # semver
created: 2026-01-15
updated: 2026-03-01
owner: risk-architecture-team
reviewers:
  - market-risk-sme
  - cib-architecture
dependencies:                    # structural deps — spec IDs only (graph-derivable)
  - id: ARCH-002
    relation: implements         # implements | constrained-by | extends | uses-data-from
  - id: DOM-REG-001
    relation: constrained-by
supersedes: null                 # ID of spec this replaces, if any
tags:
  - risk
  - var
  - market-risk
  - mifid
---
```

> **Dependencies vs. Traceability** — two distinct concerns:
>
> | Concept | Where | Purpose | Content |
> |---------|-------|---------|---------|
> | **Dependencies** | Frontmatter (`dependencies`) | Machine-readable graph of spec-to-spec relationships | Only spec/RFC/ADR IDs + relation type |
> | **Traceability** | Body section (`## Traceability`) | Human-readable context linking to code, tests, decisions, and external artifacts | Free-form: code paths, test suites, ADR rationale, RFC origin |
>
> The dependency graph is **derived automatically** by traversing all frontmatters — no central graph file needed. A linter validates that every referenced ID exists and is active. Traceability adds the narrative context that machines can't infer.

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier following `TYPE-AREA-NNN` pattern |
| `type` | enum | `spec`, `rfc`, `adr`, `guide`, `template`, `rule` |
| `layer` | enum | `architecture`, `domain`, `product`, `feature`, `documentation`, `work-spec`, `work-plan`, `work-task` |
| `status` | enum | Depends on type (see [spec-types.md](spec-types.md)) |
| `confidence` | enum | `high`, `medium`, `low` |
| `version` | semver | Semantic version |
| `owner` | string | Team or individual responsible |

### Optional fields

| Field | Type | Description |
|-------|------|-------------|
| `domain` | string | Functional domain from taxonomy |
| `subdomain` | string | Subdomain from taxonomy |
| `created` | date | Creation date |
| `updated` | date | Last modification date |
| `reviewers` | list | Required reviewers for changes |
| `dependencies` | list of `{id, relation}` | Structural spec-to-spec dependencies (see relation types below) |
| `supersedes` | string | ID of spec this replaces |
| `tags` | list | Free-form tags for discovery |
| `scope` | enum | `persistent` (knowledge artifacts) or `ephemeral` (work artifacts). Derivable from layer but explicit for clarity |
| `activates` | list of strings | Knowledge spec IDs that this work artifact activates as context. Only for work layers |
| `parent` | string | ID of parent work artifact (WRK-PLAN → WRK-SPEC, WRK-TASK → WRK-PLAN) |
| `bbva_one` | object | Optional BBVA ONE integration metadata (see below) |

### BBVA ONE integration block (optional)

For teams operating within the BBVA ONE SDLC framework, the `bbva_one` block provides bidirectional traceability with GlobalDevTools, Jira, and the Continuum deployment pipeline. Omit entirely if not using BBVA ONE.

```yaml
bbva_one:
  kb_area: markets-trading        # Federated KB area (one repo per area)
  workspace_id: WS-12345          # GlobalDevTools workspace ID
  epic_jira_id: PROJ-1234         # Jira Épica or MMF (Knowledge Artifacts + WRK-SPEC)
  feature_jira_id: PROJ-2345      # Jira Feature (WRK-SPEC scope feature)
  us_jira_id: PROJ-3456           # Jira Historia de Usuario (WRK-TASK only)
  mmf: true                       # Minimum Marketable Feature flag
  continuum_tier: 3               # Deployment security tier (1–5, from bbva-continuum)
  deploy_window_date: 2026-05-15  # Scheduled deploy window (BBVA calendar)
  one_playbook: P2                # Related ONE Playbook (P0–P5)
  one_practice: trunk-based-dev   # Related ONE practice slug
```

**Field guidance**:

| Field | Applies to | Purpose |
|-------|-----------|---------|
| `kb_area` | All | Routes spec to the correct federated KB repo |
| `workspace_id` | All | Links to GlobalDevTools project instance |
| `epic_jira_id` | Knowledge Artifacts, WRK-SPEC | Traces knowledge to the initiative that originated it |
| `feature_jira_id` | WRK-SPEC | Traces work spec to Jira Feature |
| `us_jira_id` | WRK-TASK | Traces atomic task to Jira Historia de Usuario |
| `mmf` | WRK-SPEC | Marks MMF-scoped specs for portfolio planning |
| `continuum_tier` | WRK-SPEC, ARCH-SVC-*, RULE-SEC-* | Determines mandatory documentation for deployment |
| `deploy_window_date` | WRK-SPEC | Aligns work completion with BBVA deployment calendar |
| `one_playbook` | Any | Links spec to its ONE Playbook context (see `verticals/bbva-one-taxonomy.md`) |
| `one_practice` | RULE-*, ARCH-* | Traces a rule or pattern back to the ONE practice it enforces |

### Dependency relation types

| Relation | Meaning | Example |
|----------|---------|---------|
| `implements` | This spec applies a pattern or decision defined elsewhere | Feature spec implements an architecture pattern |
| `constrained-by` | This spec must comply with rules defined elsewhere | Domain spec constrained by a regulatory spec |
| `extends` | This spec adds detail to a broader spec | Feature spec extends a product spec |
| `uses-data-from` | This spec consumes data defined in another spec | Risk spec uses market data from a data spec |
| `activates` | This work artifact uses knowledge from another spec as context | WRK-SPEC activates DOM and ARCH specs |
| `depends-on` | This artifact depends on another being completed or available | WRK-TASK depends on another WRK-TASK |
| `supersedes` | This spec replaces an older version | New ARCH spec supersedes a deprecated one |

---

## Derived Knowledge Graph

The `dependencies` field in the frontmatter is the **distributed graph**. Each spec declares its outgoing edges; the full graph is derived by scanning all frontmatters.

### Architecture: derived, not centralized

There is no central `graph.json` checked into the repository — that would create a second source of truth with inevitable drift. Instead, the `spec-graph` CLI scans all specs and produces derived artifacts at build-time:

```
specs/**/*.md (frontmatter.dependencies)
        │
        │  spec-graph CLI (scan + parse)
        ▼
_build/graph.json      ← full adjacency list
_build/graph.mermaid   ← visual diagram
```

### Inverse relations

The CLI automatically derives inverse edges:

| Declared relation | Inverse (auto-derived) |
|-------------------|----------------------|
| `implements` | `implemented-by` |
| `constrained-by` | `constrains` |
| `extends` | `extended-by` |
| `uses-data-from` | `data-used-by` |
| `activates` | `activated-by` |
| `depends-on` | `depended-on-by` |
| `supersedes` | `superseded-by` |

This enables **impact analysis**: "if I change DOM-REG-001, what specs are affected?" — answered by traversing the inverse graph transitively (BFS).

### CLI usage

See `apps/spec-graph/spec-graph.mjs` or run `node apps/spec-graph/spec-graph.mjs --help`. Key commands: `build`, `visualize`, `impact <id>`, `orphans`, `validate`, `stats`.

---

## Standard Sections

After the frontmatter, every spec follows this section structure. Not all sections are required for every spec type — see the notes column.

### 1. Intent

**What** this spec defines and **why** it exists.

```markdown
## Intent

Brief statement of what this specification defines and the business/technical
need it addresses. Should be understandable by a non-technical stakeholder.
```

### 2. Definition

The **core content** — the knowledge being formalized. Structure varies by spec layer:

- **Architecture**: Context → Decision → Rationale → Consequences
- **Domain**: Concept → Rules → Constraints → Examples
- **Product**: Purpose → Actors → Flow → Acceptance Criteria
- **Feature**: Purpose → Inputs → Behavior → Outputs
- **Documentation**: Purpose → Audience → Content outline
- **Work-Spec**: Problem Statement → Proposed Change → Knowledge Context → Constraints → Acceptance Criteria → Open Questions
- **Work-Plan**: Approach → Task Breakdown → Architecture Impact → Risk Assessment → Dependencies
- **Work-Task**: Objective → Implementation Notes → Acceptance Criteria → Test Plan

### 3. Acceptance Criteria

**Testable conditions** that determine whether an implementation conforms to this spec.

```markdown
## Acceptance Criteria

- [ ] VaR calculation uses historical simulation with 250-day window
- [ ] Confidence interval is 99% for regulatory VaR, 95% for internal
- [ ] Results are produced within T+0 for all asset classes
- [ ] Stress scenarios include at least the 6 prescribed regulatory scenarios
```

### 4. Evidence

**Artifacts** that support this spec's content — screenshots, recordings, test results, expert validation records.

```markdown
## Evidence

| Type | Reference | Date | Confidence impact |
|------|-----------|------|-------------------|
| Expert review | @market-risk-sme session 2026-01-20 | 2026-01-20 | LOW → MEDIUM |
| Testing | VAR-integration-test-suite-v3 | 2026-02-15 | MEDIUM → HIGH |
```

### 5. Traceability

**Links to non-spec artifacts**: code modules, test suites, external documents, and narrative context that complements the structural dependencies in the frontmatter. Spec-to-spec relationships belong in `dependencies` (frontmatter); this section covers everything else.

```markdown
## Traceability

| Relation | Target | Description |
|----------|--------|-------------|
| Implemented in | `risk-service/src/var/` | VaR calculation module |
| Tested by | `risk-service/tests/var/` | VaR test suite |
| Decided in | ADR-015 | Historical simulation chosen over Monte Carlo |
| RFC origin | RFC-008 | Proposal to standardize VaR methodology |
| External ref | Basel III CRR Art. 365-367 | Regulatory basis |
```

---

## Complete Example: DOM-RISK-001

```markdown
---
id: DOM-RISK-001
type: spec
layer: domain
domain: Markets & Trading
subdomain: Risk Management
status: active
confidence: high
version: 1.2.0
created: 2026-01-15
updated: 2026-03-01
owner: risk-architecture-team
reviewers:
  - market-risk-sme
  - cib-architecture
dependencies:
  - id: ARCH-002
    relation: implements
  - id: DOM-REG-001
    relation: constrained-by
  - id: DOM-DATA-001
    relation: uses-data-from
tags:
  - risk
  - var
  - market-risk
---

# DOM-RISK-001 — Market Risk Calculation (VaR)

## Intent

Defines the rules and constraints for calculating Value at Risk (VaR) across
the CIB trading book. VaR is the primary market risk metric used for internal
risk management and regulatory reporting under Basel III/IV and MiFID II.

## Definition

### Concept

Value at Risk (VaR) estimates the maximum potential loss of a portfolio over
a defined holding period at a given confidence level. It is calculated daily
for all positions in the trading book.

### Rules

1. **Method**: Historical simulation using a rolling 250-business-day window
2. **Holding period**: 10 days for regulatory VaR, 1 day for internal
3. **Confidence level**: 99% for regulatory, 95% for internal risk monitoring
4. **Asset coverage**: All positions in the trading book — equities, fixed
   income, FX, commodities, and derivatives
5. **Netting**: Positions are netted at counterparty level per CSA agreement

### Constraints

- **Regulatory**: Basel III/IV requires 10-day 99% VaR with at least 250 days
  of historical data (BCBS 239)
- **MiFID II**: Risk metrics must be available for client reporting within T+1
- **DORA**: Calculation infrastructure must meet 99.99% availability
- **Data quality**: Market data inputs must come from the golden source
  (DOM-DATA-001) with no stale prices older than T-1

### Examples

**Scenario**: FX Spot portfolio with EUR/USD and GBP/USD positions

| Position | Notional | Currency | VaR (1d, 95%) | VaR (10d, 99%) |
|----------|----------|----------|----------------|-----------------|
| EUR/USD long | 50M | EUR | 280K | 1.2M |
| GBP/USD short | 30M | GBP | 195K | 850K |
| **Portfolio** | — | — | **410K** | **1.8M** |

*Note: Portfolio VaR < sum of individual VaRs due to diversification benefit.*

## Acceptance Criteria

- [ ] VaR engine uses historical simulation with 250-business-day rolling window
- [ ] Regulatory VaR: 10-day holding period, 99% confidence interval
- [ ] Internal VaR: 1-day holding period, 95% confidence interval
- [ ] All trading book asset classes covered (equities, FI, FX, commodities, derivatives)
- [ ] Netting applied per counterparty per CSA
- [ ] Market data sourced exclusively from golden source (DOM-DATA-001)
- [ ] Results available by 07:00 CET for T-1 positions
- [ ] Stress VaR includes minimum 6 prescribed regulatory scenarios
- [ ] Backtesting: actual P&L exceptions ≤ 4 per rolling 250-day window (green zone)

## Evidence

| Type | Reference | Date | Confidence impact |
|------|-----------|------|-------------------|
| Expert review | Market Risk SME session | 2026-01-20 | Initial → MEDIUM |
| Regulatory mapping | Basel III CRR Art. 365-367 | 2026-01-25 | — |
| Integration testing | VAR-integration-suite-v3 | 2026-02-15 | MEDIUM → HIGH |
| Backtesting | 12-month backtest (2025) | 2026-02-28 | Confirms HIGH |

## Traceability

> Spec-to-spec dependencies are in the frontmatter. This section covers code, tests, decisions, and external references.

| Relation | Target | Description |
|----------|--------|-------------|
| Implemented in | `risk-service/src/var/` | VaR calculation module |
| Tested by | `risk-service/tests/var/` | VaR test suite |
| Decided in | ADR-015 | Historical simulation chosen over Monte Carlo |
| RFC origin | RFC-008 | Proposal to standardize VaR methodology |
| External ref | Basel III CRR Art. 365-367 | Regulatory basis for VaR parameters |
```

---

## Validation Checklist

When creating or reviewing a spec, verify:

- [ ] **Frontmatter complete**: all required fields present and valid
- [ ] **ID pattern correct**: matches `TYPE-AREA-NNN` from [spec-types.md](spec-types.md)
- [ ] **Layer consistent**: frontmatter layer matches the spec's content scope
- [ ] **Dependencies exist**: all referenced spec IDs are real and active
- [ ] **Confidence justified**: evidence section supports the stated confidence level
- [ ] **Acceptance criteria testable**: each criterion can be verified programmatically or by observation
- [ ] **Traceability complete**: links to parent specs, implementations, tests, and decisions
