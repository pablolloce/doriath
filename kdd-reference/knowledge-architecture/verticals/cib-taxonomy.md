# CIB Taxonomy — Corporate & Investment Banking

> Example vertical taxonomy for the Knowledge-Driven Development framework.

This document defines the functional and technical domain trees for CIB. It serves as the reference implementation for how to apply the framework's [unified taxonomy](../../knowledge-architecture/unified-taxonomy.md) to a specific industry vertical.

Other verticals (Retail Banking, Insurance, Telco, Utilities) would follow the same structure with their own domain trees.

---

## Functional Domain

```
CIB Business Domain
│
├── Markets & Trading
│   ├── Order Management
│   │   └── order routing, execution, allocation, order lifecycle
│   ├── Market Data
│   │   └── pricing feeds, reference data, indices, curves
│   ├── Risk Management
│   │   └── market risk, credit risk, counterparty risk, VaR, stress testing
│   ├── Post-Trade
│   │   └── clearing, settlement, reconciliation, custody, fails management
│   └── Algorithmic Trading
│       └── strategy execution, smart order routing, latency optimization
│
├── Investment Banking
│   ├── Deal Management
│   │   └── origination, structuring, syndication, pipeline tracking
│   ├── Capital Markets Origination
│   │   └── DCM, ECM, securitization, bookbuilding
│   └── M&A Advisory
│       └── valuation models, due diligence, fairness opinions
│
├── Corporate Banking
│   ├── Lending
│   │   └── origination, underwriting, servicing, syndicated loans
│   ├── Transaction Banking
│   │   └── cash management, payments, trade finance, supply chain finance
│   ├── Treasury Services
│   │   └── FX, hedging, liquidity management, interest rate management
│   └── Custody & Securities Services
│       └── safekeeping, corporate actions, fund administration, transfer agency
│
├── Cross-CIB Capabilities
│   ├── Client Lifecycle Management
│   │   └── onboarding, KYC/AML, credit assessment, periodic review
│   ├── Regulatory & Compliance
│   │   └── MiFID II, EMIR, DORA, Basel IV, FATCA/CRS, regulatory reporting
│   ├── Data Management
│   │   └── trade data lineage, golden source, data quality, data governance
│   └── Operations & Middle Office
│       └── confirmations, breaks management, exception handling, corporate actions
│
└── Business Rules Catalog
    ├── Validation Rules
    │   └── trade validation, limit checks, eligibility rules, pre-trade checks
    ├── Calculation Rules
    │   └── pricing, P&L attribution, risk metrics, margin calculation, fees
    ├── Workflow Rules
    │   └── approval chains, four-eyes principle, escalation, STP thresholds
    └── Regulatory Rules
        └── reporting obligations, capital requirements, position limits, best execution
```

---

## Technical Domain

The technical domain is largely shared across verticals. CIB-specific NFR targets are noted inline.

```
Technical Domain
│
├── Architecture Patterns
│   ├── Application
│   │   └── microservices, event-driven, CQRS, hexagonal, modular monolith
│   ├── Integration
│   │   └── API gateway, saga, transactional outbox, CDC, message broker, BFF
│   ├── Data
│   │   └── event sourcing, polyglot persistence, data mesh, lakehouse, CDC
│   └── Security
│       └── zero trust, OAuth2/OIDC, mTLS, secrets management, vault
│
├── NFR Catalog
│   ├── Performance
│   │   └── latency (<10ms trading, <200ms web), throughput, scalability
│   ├── Reliability
│   │   └── availability (99.99%), disaster recovery, resilience, circuit breakers
│   ├── Security
│   │   └── encryption at rest/in transit, RBAC/ABAC, audit trail, PII handling
│   └── Operability
│       └── observability, deployment automation, maintainability, runbook coverage
│
├── Technology Standards
│   ├── Languages & Frameworks
│   │   └── approved stacks, version policies, migration paths
│   ├── Platforms & Infrastructure
│   │   └── cloud providers, container orchestration, IaC, networking
│   ├── Data Stores & Messaging
│   │   └── RDBMS, NoSQL, event streaming, caching, search
│   └── Observability & Monitoring
│       └── logging, tracing, metrics, alerting, SLO definition
│
└── Quality Standards
    ├── Code Quality
    │   └── conventions, complexity thresholds, coverage targets, static analysis
    ├── API Standards
    │   └── naming, versioning, error handling, pagination, rate limiting
    ├── Testing Standards
    │   └── test pyramid, coverage requirements, automation levels, E2E strategy
    └── Documentation Standards
        └── ADR requirements, runbook format, API docs, changelog
```

---

## Activation Matrix: CIB × SDLC

How CIB domain knowledge activates at each SDLC phase:

| SDLC Phase | Functional Knowledge Activated | Technical Knowledge Activated | Artifacts Produced |
|------------|-------------------------------|-------------------------------|-------------------|
| **Requirements** | CIB domain + Business Rules + Regulatory | — | DOM specs, PROD specs |
| **Design** | Domain Specs + Cross-CIB capabilities | Architecture Patterns + NFRs + API Standards | ARCH specs, ADRs, OpenAPI contracts |
| **Build** | Feature Specs + Business Rules | Technology Standards + Quality Standards | Code, FEAT specs |
| **Test** | All specs (business rules = test cases) | Testing Standards + NFRs | Test suites, validation reports |
| **Deploy** | Operational guides | NFRs + Observability | SLO compliance, operational ADRs |

### CIB Activation Example

During the **Requirements** phase, an agent or developer working on a CIB trade execution feature would automatically receive:
- Relevant DOM specs (e.g., `DOM-RISK-001` for risk calculation rules)
- Applicable business rules from the catalog (e.g., pre-trade validation rules)
- Regulatory constraints (e.g., MiFID II best execution requirements)

During **Design**, the same feature would activate:
- Architecture patterns (e.g., event-driven for trade lifecycle)
- NFR targets (e.g., <10ms latency for order execution)
- API standards (e.g., naming conventions for trading endpoints)
