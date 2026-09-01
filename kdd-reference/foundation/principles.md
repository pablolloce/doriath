# Four Design Principles

The three pillars define **what** we do. These four principles define **how** we ensure practical adoption. They are constraints that guide every decision in the framework.

---

## 1. Everything as Code

> *Human-readable, machine-executable.*

Specifications are written in formats that both humans can read and machines can parse. This dual nature enables:

- **Automated validation** — specs are checked in CI/CD pipelines, not in manual reviews
- **Generation** — code, tests, and documentation are derived from specs
- **Version control** — every change has a history, author, and rationale
- **Collaboration** — pull requests, reviews, and diff-based workflows

### In practice

| Artifact | Format | Tooling |
|----------|--------|---------|
| Specs | Markdown + YAML frontmatter | Git, linters, validators |
| API contracts | OpenAPI / AsyncAPI | Code generators, mock servers |
| Business rules | JSON Schema / OPA / CEL | Rule engines, automated tests |
| Architecture decisions | ADR (Markdown + YAML) | ADR tools, governance agents |

---

## 2. Layered Artifact Hierarchy

> *Right knowledge at the right level, right work at the right scope.*

Artifacts are organized along three orthogonal axes: **Knowledge** (persistent, organizational), **Work** (ephemeral, scoped to a change), and **Governance** (decisions and rules that bridge the two). Each axis has its own layers, scope, and lifecycle.

### Knowledge Layers (persistent)

| Layer | ID Pattern | Scope | Example |
|-------|-----------|-------|---------|
| **Architecture** | `ARCH-NNN` | Technology principles, patterns, infrastructure decisions | Microservices communication, event-driven patterns |
| **Domain** | `DOM-AREA-NNN` | Business knowledge, rules, regulatory requirements | Risk calculation rules, KYC/AML requirements |
| **Product** | `PROD-JOURNEY-NNN` | Product-level requirements, end-to-end user journeys | Customer onboarding flow, trade execution flow |
| **Feature** | `FEAT-MODULE-NNN` | Specific functionality, screens, behaviors | Identity verification, document upload |
| **Documentation** | `DOC-TYPE-NNN` | Supporting materials, guides, runbooks | API guide, deployment runbook |

### Work Layers (ephemeral)

| Layer | ID Pattern | Scope | Example |
|-------|-----------|-------|---------|
| **Work Spec** | `WRK-SPEC-NNN` | What needs to change and why | VaR engine redesign specification |
| **Work Plan** | `WRK-PLAN-NNN` | How the change will be implemented | VaR engine implementation plan |
| **Work Task** | `WRK-TASK-NNN` | Atomic unit of implementation work | VaR calculation service |

### Governance Layers (bridge)

| Type | Purpose | Example |
|------|---------|---------|
| **RFC** | Propose changes to standards or patterns | Proposal to adopt event sourcing for trades |
| **ADR** | Record decisions with context and rationale | Historical simulation chosen over Monte Carlo |
| **RULE** | Codify constraints for automated validation | Trade validation rules (JSON Schema / OPA) |

### Why layers matter

- **Inheritance**: lower layers inherit constraints from upper layers (a feature spec must comply with domain rules and architecture patterns)
- **Independence**: changes at one layer don't cascade unnecessarily to others
- **Appropriate detail**: strategic stakeholders read architecture specs; developers read feature specs
- **Governance**: each layer can have different owners, review processes, and update frequencies
- **Activation**: Work layers reference Knowledge layers via `activates`, injecting organizational knowledge into the work stream without duplicating it
- **Bridge**: Governance artifacts connect both axes — RFCs propose changes, ADRs record decisions, RULEs enforce constraints

---

## 3. Universal Applicability

> *One framework, any starting point.*

The framework adapts to any project context without modification:

### Brownfield (modernization)

- Incrementally document legacy systems while replacing them
- Start with discovery: capture existing behavior as specs
- Build the knowledge base progressively as modules are modernized
- Each spec becomes the contract for the new implementation

### Greenfield (new development)

- Build with specs from day one
- Specs precede code: define before implementing
- The spec repository grows alongside the codebase
- Full traceability from the start

### Hybrid (most real projects)

- New features built spec-first on top of documented legacy
- Progressive enrichment: every touchpoint adds knowledge
- Legacy specs at LOW confidence, new specs at HIGH confidence

---

## 4. Incremental Adoption

> *Start where you are, grow as you go.*

This is not all-or-nothing. Teams can start small, progressively incorporating knowledge that enables increasing levels of AI assistance and automation.

### Adoption levels

| Level | What you do | What you get |
|-------|-------------|-------------|
| **L1 — Document** | Write specs for critical areas | Shared understanding, onboarding acceleration |
| **L2 — Validate** | Add confidence levels + review cycles | Quality governance, regulatory evidence |
| **L3 — Automate** | Integrate spec validation in CI/CD | Continuous compliance, deviation detection |
| **L4 — Generate** | Use specs to generate code + tests | Accelerated delivery with guaranteed alignment |
| **L5 — Orchestrate** | Deploy spec-driven agents | Autonomous governance, knowledge amplification |

Each level builds on the previous one. An organization can operate at L1 for some domains and L4 for others. There is no requirement to reach L5 — each level delivers standalone value.

### Key insight

The effort to reach each level is **incremental**, but the value is **compounding**: L3 is not 3x L1, it's 10x. The structured knowledge accumulated at lower levels becomes exponentially more valuable as automation capabilities increase.

---

## 5. Compliance-as-Knowledge

> *Regulatory and process requirements are first-class Knowledge Artifacts, not documents.*

In regulated environments, frameworks such as BBVA ONE, DORA, MiFID II, or Basel IV impose mandatory practices on how software is built, tested, and deployed. The default response is to produce compliance documents — static PDFs that rot from the moment they are written.

This principle inverts that: **compliance requirements become `RULE` specs** with confidence `HIGH`, versioned in Git, and validated in CI/CD. The audit trail is the Git history; the evidence is the spec confidence lifecycle.

### In practice

| Compliance source | KDD artifact | Validation |
|------------------|-------------|-----------|
| BBVA ONE Playbook P3 directive (e.g. "code coverage ≥ 80%") | `RULE-QUALITY-NNN` | Enforced in pipeline |
| DORA operational resilience requirement | `RULE-DORA-NNN` · `DOM-REG-DORA-NNN` | Enforced as NFR in ARCH specs |
| MiFID II best execution rule | `DOM-REG-001` + `RULE-EXEC-NNN` | Validated in trade processing tests |
| MSA security control (ARA) | `RULE-SEC-SVC-NNN` | OPA/JSON Schema gate in CI |
| ONE Continuum Tier requirement | `bbva_one.continuum_tier` in WRK-SPEC | Deploy pipeline checks tier compliance |

### Maturity alignment: ONE levels ↔ KDD levels

| BBVA ONE Maturity | KDD Adoption Level | What it means in practice |
|-------------------|--------------------|--------------------------|
| Level 1 — Practitioner | L1 Document + L2 Validate | Specs exist, confidence levels assigned, review cycles active |
| Level 2 — Continuous Integration | L3 Automate | `RULE` specs enforced in CI; `spec-graph validate` is a CI gate |
| Level 3 — Continuous Delivery | L3–L4 Automate + Generate | Spec-driven test generation; full traceability in pipelines |
| Level 4 — Continuous Deployment | L4 Generate | Automated deployment gates check spec compliance |
| Level 5 — Top | L5 Orchestrate | Agents govern knowledge evolution; autonomous compliance reporting |
| Level 6 — Principios de Actuación | Transversal (all levels) | Collaboration, automation, and measurement baked into every cycle |

The alignment is not 1:1 — it is directional. A team at ONE Level 2 should be investing in KDD L3 to make their CI compliance durable, not just procedural.
