---
id: FEAT-REG-001
type: spec
layer: feature
domain: Regulatory & Compliance
subdomain: Reporting Engine
status: active
confidence: high
version: 1.2.0
created: 2026-01-25
updated: 2026-03-06
owner: regulatory-engineering-team
dependencies:
  - id: DOM-REG-001
    relation: implements
  - id: DOM-REG-002
    relation: implements
  - id: ARCH-003
    relation: implements
  - id: ARCH-002
    relation: implements
tags:
  - reporting
  - regulatory
  - mifid
  - emir
  - automation
---

# FEAT-REG-001 — Regulatory Reporting Engine

## Intent

Implements the unified regulatory reporting engine that handles MiFID II
transaction reporting, EMIR trade reporting, and CSDR settlement reporting.

## Definition

### Supported Regimes

- MiFID II: Transaction reports to ARM (DTCC GTR)
- EMIR Refit: Trade reports to Trade Repository (DTCC GTR)
- CSDR: Settlement fail reports and penalty calculations
- SFTR: Securities financing transaction reports

### Architecture

- Consumes trade events from Kafka (ARCH-002)
- Enriches with reference data from data lake (ARCH-003)
- Transforms to ISO 20022 XML format
- Submits via SFTP/API to Trade Repository
- Reconciles acknowledgments and manages rejections

### SLA

- T+1 submission: 99.5% of trades reported on time
- Rejection rate: < 0.5%
- Reconciliation: daily with < 2% breaks

## Acceptance Criteria

- [ ] Reports submitted within T+1 for all regimes
- [ ] ISO 20022 XML validation passes before submission
- [ ] Rejection handling with auto-correction for known patterns
- [ ] Dashboard showing real-time reporting status per regime
