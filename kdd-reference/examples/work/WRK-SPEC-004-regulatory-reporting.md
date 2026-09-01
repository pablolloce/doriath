---
id: WRK-SPEC-004
type: spec
layer: work-spec
scope: ephemeral
status: draft
confidence: medium
version: 0.1.0
created: 2026-03-05
updated: 2026-03-18
owner: regulatory-tech-team
reviewers:
  - compliance-sme
  - cib-architecture
activates:
  - FEAT-REG-001
  - DOM-REG-001
  - DOM-REG-002
  - ARCH-003
dependencies:
  - id: DOM-REG-001
    relation: constrained-by
  - id: DOM-REG-002
    relation: constrained-by
tags:
  - regulatory
  - reporting
  - mifid
  - emir
  - automation
---

# WRK-SPEC-004 — Regulatory Reporting Automation

## Problem Statement

Regulatory reporting currently relies on a patchwork of manual processes and legacy batch jobs, producing MiFID II transaction reports and EMIR trade reports with T+2 latency. Regulators are tightening to T+1 deadlines, and the current process has a 3% error rate requiring manual remediation. The compliance team spends ~40% of their time on report reconciliation.

## Proposed Change

Build an automated regulatory reporting engine that:

1. **Generates** MiFID II transaction reports and EMIR trade reports from trade lifecycle events
2. **Validates** reports against regulatory schemas before submission
3. **Submits** to ARMs/TRs via approved channels with acknowledgment tracking
4. **Reconciles** submitted reports with source data automatically

## Knowledge Context

| Activated Spec | Role in this work |
|---------------|-------------------|
| **FEAT-REG-001** (Regulatory Reporting Engine) | Feature spec for the reporting platform |
| **DOM-REG-001** (MiFID II Best Execution) | MiFID II transaction reporting rules and field mappings |
| **DOM-REG-002** (EMIR Reporting) | EMIR trade reporting rules, UTI generation, delegation model |
| **ARCH-003** (Data Lake Architecture) | Source data for report generation and audit trail storage |

## Constraints

- MiFID II: T+1 reporting deadline (by 2026-07 regulatory change)
- EMIR Refit: ISO 20022 XML format mandatory from 2026-04
- All reports must be reconcilable to source trades within 24 hours
- Audit trail retained for minimum 5 years
- Report error rate target: < 0.1%

## Acceptance Criteria

- [ ] MiFID II transaction reports generated within T+1
- [ ] EMIR trade reports in ISO 20022 XML format
- [ ] Pre-submission validation catches 99% of format/content errors
- [ ] Automated submission to 2+ ARMs with acknowledgment tracking
- [ ] Reconciliation engine with exception-based review workflow
- [ ] Error rate < 0.1% (vs current 3%)
