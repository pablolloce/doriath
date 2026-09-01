---
id: DOM-REG-001
type: spec
layer: domain
domain: Regulatory & Compliance
subdomain: MiFID II
status: active
confidence: high
version: 2.0.0
created: 2026-01-05
updated: 2026-03-01
owner: regulatory-architecture-team
reviewers:
  - compliance-sme
  - cib-architecture
tags:
  - mifid
  - regulation
  - best-execution
---

# DOM-REG-001 — MiFID II Best Execution Requirements

## Intent

Formalizes the MiFID II best execution obligations that constrain all order execution
and trade reporting across the CIB platform.

## Definition

### Concept

MiFID II requires investment firms to take all sufficient steps to obtain the best
possible result for clients when executing orders, considering price, costs, speed,
likelihood of execution and settlement, size, nature, and any other relevant consideration.

### Rules

1. **Best execution policy**: Must be documented and disclosed to clients
2. **Top 5 venues**: Annual publication of top 5 execution venues per asset class
3. **Transaction reporting**: Real-time reporting to ARM within T+1
4. **Record keeping**: All orders and transactions retained for 5 years

### Constraints

- Applies to all MiFID-regulated entities within the group
- Pre-trade and post-trade transparency obligations differ by asset class
- Systematic internaliser thresholds must be monitored quarterly

## Acceptance Criteria

- [ ] Best execution policy published and reviewed annually
- [ ] Top 5 venues report generated per RTS 28
- [ ] Transaction reports submitted to ARM within T+1
- [ ] All order records retained for minimum 5 years
