---
id: DOM-TRADE-002
type: spec
layer: domain
domain: Markets & Trading
subdomain: Order Management
status: active
confidence: medium
version: 1.0.0
created: 2026-02-10
updated: 2026-03-06
owner: trading-architecture-team
dependencies:
  - id: DOM-TRADE-001
    relation: extends
  - id: DOM-RISK-001
    relation: constrained-by
  - id: DOM-REG-001
    relation: constrained-by
tags:
  - order
  - management
  - routing
  - smart-order
---

# DOM-TRADE-002 — Order Management System

## Intent

Specifies the order management rules governing order capture, validation,
smart order routing, and execution reporting.

## Definition

### Rules

1. Orders validated against: instrument eligibility, client mandate, risk limits
2. Smart order routing considers: price, liquidity, venue fees, best execution obligation
3. Partial fills aggregated and reported as single execution to client
4. Order lifecycle states: New → Validated → Routed → Filled → Reported

### Constraints

- Client limit orders valid for session unless GTC specified
- Market orders executed immediately or cancelled (IOC)
- All routing decisions logged for best execution evidence

## Acceptance Criteria

- [ ] Order validation completes in < 5ms
- [ ] Smart order router evaluates minimum 3 venues per order
- [ ] Best execution evidence captured for every order
- [ ] Partial fills correctly aggregated in client reporting
