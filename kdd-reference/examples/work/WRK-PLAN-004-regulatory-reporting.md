---
id: WRK-PLAN-004
type: spec
layer: work-plan
scope: ephemeral
status: draft
confidence: medium
version: 0.1.0
created: 2026-03-08
updated: 2026-03-18
owner: regulatory-tech-team
parent: WRK-SPEC-004
activates:
  - FEAT-REG-001
  - DOM-REG-001
  - DOM-REG-002
dependencies:
  - id: WRK-SPEC-004
    relation: implements
  - id: DOM-REG-001
    relation: constrained-by
  - id: DOM-REG-002
    relation: constrained-by
tags:
  - regulatory
  - reporting
  - plan
---

# WRK-PLAN-004 — Regulatory Reporting Automation — Implementation Plan

## Approach

Event-driven reporting pipeline consuming trade lifecycle events:

```
Trade Events (Kafka) → Report Engine → Validator → Submitter → Reconciler
                            │                          │
                    Template Library              ARM/TR Gateway
                            │
                      Data Lake (audit)
```

## Task Breakdown

| Task ID | Description | Estimated effort | Dependencies |
|---------|-------------|-----------------|-------------|
| WRK-TASK-009 | Report Generation Engine | 5 days | — |
| WRK-TASK-010 | MiFID II / EMIR Report Templates | 3 days | WRK-TASK-009 |

## Architecture Impact

| Constraint | Source | Impact on plan |
|-----------|--------|---------------|
| T+1 MiFID II deadline | DOM-REG-001 | Near-real-time event processing required |
| ISO 20022 XML format | DOM-REG-002 | EMIR templates must produce valid ISO 20022 |
| Data lake source | ARCH-003 | Trade events enriched from data lake for report fields |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| EMIR Refit schema changes before go-live | High | Medium | Template versioning with hot-swap capability |
| ARM gateway downtime during submission window | Medium | High | Multi-ARM submission with automatic failover |
| Data quality issues in source trades | Medium | High | Pre-enrichment validation with exception routing |
