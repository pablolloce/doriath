---
id: DOM-REG-002
type: spec
layer: domain
domain: Regulatory & Compliance
subdomain: EMIR
status: active
confidence: high
version: 1.3.0
created: 2026-01-15
updated: 2026-03-05
owner: regulatory-architecture-team
dependencies:
  - id: DOM-TRADE-001
    relation: uses-data-from
  - id: ARCH-003
    relation: implements
tags:
  - emir
  - regulation
  - trade-reporting
  - derivatives
---

# DOM-REG-002 — EMIR Trade Reporting

## Intent

Formalizes EMIR Refit reporting obligations for all OTC and exchange-traded
derivative transactions.

## Definition

### Rules

1. All derivative trades reported to authorized Trade Repository within T+1
2. UTI (Unique Transaction Identifier) generated at point of execution
3. Lifecycle events (amendments, terminations) reported within T+1
4. Counterparty data reconciled quarterly per EMIR Refit
5. Collateral and valuation reported daily for non-cleared OTC derivatives

### Data Quality

- ISO 20022 XML format mandatory
- LEI validation required for all counterparties
- Tolerance thresholds for valuation discrepancies: 10% for < 1yr maturity

## Acceptance Criteria

- [ ] T+1 reporting rate > 99.5%
- [ ] UTI generated and shared with counterparty at execution
- [ ] Reconciliation breaks resolved within 10 business days
- [ ] Daily valuation reports submitted for all in-scope derivatives
