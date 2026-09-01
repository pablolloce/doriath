---
id: WRK-TASK-010
type: spec
layer: work-task
scope: ephemeral
status: draft
confidence: medium
version: 0.1.0
created: 2026-03-15
updated: 2026-03-18
owner: regulatory-tech-team
parent: WRK-PLAN-004
activates:
  - DOM-REG-001
  - DOM-REG-002
dependencies:
  - id: WRK-PLAN-004
    relation: implements
  - id: WRK-TASK-009
    relation: depends-on
  - id: DOM-REG-001
    relation: constrained-by
  - id: DOM-REG-002
    relation: constrained-by
tags:
  - regulatory
  - mifid
  - emir
  - templates
  - implementation
---

# WRK-TASK-010 — MiFID II / EMIR Report Templates

## Objective

Implement the regulatory report templates that render report payloads into the format required by ARMs (Approved Reporting Mechanisms) and Trade Repositories, including MiFID II transaction reports and EMIR trade reports in ISO 20022 XML.

## Implementation Notes

### MiFID II Transaction Report

- 65 fields per RTS 25
- XML format per ARM specifications
- Fields include: LEI, trading date/time, venue MIC, instrument ISIN, price, quantity, buyer/seller indicators

### EMIR Trade Report (Refit)

- ISO 20022 XML (auth.030, auth.031)
- 203 fields per EMIR Refit RTS
- UTI as primary identifier
- Lifecycle events: new, modify, correct, terminate, compress

### Template Engine

- Versioned templates with effective date ranges
- Hot-swap capability for regulatory changes
- Pre-submission schema validation against XSD

## Acceptance Criteria

- [ ] MiFID II template produces valid ARM-compatible XML
- [ ] EMIR template produces valid ISO 20022 auth.030/auth.031
- [ ] Schema validation catches all format errors before submission
- [ ] Template versioning with effective date management
- [ ] Test pack validation: 100% pass rate against ESMA/FCA test vectors
