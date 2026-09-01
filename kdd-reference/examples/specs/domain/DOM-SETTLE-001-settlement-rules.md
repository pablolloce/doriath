---
id: DOM-SETTLE-001
type: spec
layer: domain
domain: Post-Trade & Settlement
subdomain: Settlement
status: active
confidence: high
version: 1.2.0
created: 2026-01-20
updated: 2026-03-01
owner: post-trade-team
dependencies:
  - id: DOM-TRADE-001
    relation: extends
  - id: ARCH-002
    relation: implements
  - id: DOM-REG-001
    relation: constrained-by
tags:
  - settlement
  - csdr
  - reconciliation
  - dvp
---

# DOM-SETTLE-001 — Settlement Rules & CSDR Compliance

## Intent

Defines settlement rules, fail management, and CSDR penalty regime
applicable to all CIB trade settlement.

## Definition

### Rules

1. Standard settlement cycle: T+2 for equities, T+1 for government bonds
2. DVP (Delivery vs Payment) mandatory for all exchange-traded instruments
3. Settlement fail penalties calculated per CSDR regime
4. Auto-borrowing triggered for anticipated fails > €500K

### Fail Management

- T+1 warning: pre-matching status checked
- T+2 (SD): settlement attempted
- T+3: auto-borrow initiated
- T+4: buy-in process initiated per CSDR

## Acceptance Criteria

- [ ] Settlement instructions generated T+0
- [ ] Pre-matching rate > 95% by T+1
- [ ] CSDR penalties correctly calculated and allocated
- [ ] Auto-borrow triggered within SLA for anticipated fails
