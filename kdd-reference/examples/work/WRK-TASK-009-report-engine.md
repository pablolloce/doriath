---
id: WRK-TASK-009
type: spec
layer: work-task
scope: ephemeral
status: draft
confidence: medium
version: 0.1.0
created: 2026-03-12
updated: 2026-03-18
owner: regulatory-tech-team
parent: WRK-PLAN-004
activates:
  - FEAT-REG-001
  - DOM-REG-001
dependencies:
  - id: WRK-PLAN-004
    relation: implements
  - id: DOM-REG-001
    relation: constrained-by
tags:
  - regulatory
  - report-engine
  - implementation
---

# WRK-TASK-009 — Report Generation Engine

## Objective

Build the core report generation engine that consumes trade lifecycle events, applies regulatory field mappings, and produces structured report payloads ready for template rendering and submission.

## Implementation Notes

### Event-Driven Pipeline

1. **Consume** trade lifecycle events from Kafka (new trade, amendment, cancellation)
2. **Enrich** with reference data (counterparty LEI, venue MIC, product taxonomy)
3. **Map** to regulatory field set per DOM-REG-001 / DOM-REG-002 rules
4. **Generate** report payload with UTI/transaction reference
5. **Validate** against regulatory schema
6. **Route** to appropriate template (MiFID II or EMIR)

### Reportable Determination

Not all trades are reportable. The engine must implement:
- MiFID II: instrument scope (TOTV/TOTVFIA), exemptions
- EMIR: derivative scope, intragroup exemptions, delegation model

## Acceptance Criteria

- [ ] Consumes trade events with <1s processing latency
- [ ] Correct reportable determination for all asset classes
- [ ] UTI generation per CPMI-IOSCO guidelines
- [ ] Field mapping accuracy ≥ 99.9% against test packs
- [ ] Handles trade amendments and cancellations (action types: NEW, MODIFY, CANCEL)
- [ ] Idempotent processing (duplicate events produce no duplicate reports)
