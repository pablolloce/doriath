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
  - mifid
---

# DOM-RISK-001 — Market Risk Calculation (VaR)

## Intent

Defines the rules and constraints for calculating Value at Risk (VaR) across
the CIB trading book.

## Definition

### Rules

1. **Method**: Historical simulation using a rolling 250-business-day window
2. **Holding period**: 10 days for regulatory VaR, 1 day for internal
3. **Confidence level**: 99% for regulatory, 95% for internal risk monitoring

## Acceptance Criteria

- [ ] VaR engine uses historical simulation with 250-business-day rolling window
- [ ] Regulatory VaR: 10-day holding period, 99% confidence interval
- [ ] Internal VaR: 1-day holding period, 95% confidence interval
