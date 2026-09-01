---
id: FEAT-RISK-001
type: spec
layer: feature
domain: Markets & Trading
subdomain: Risk Management
status: draft
confidence: medium
version: 0.1.0
created: 2026-03-01
updated: 2026-03-05
owner: risk-engineering-team
dependencies:
  - id: DOM-RISK-001
    relation: extends
  - id: DOM-DATA-001
    relation: uses-data-from
tags:
  - risk
  - limits
  - real-time
---

# FEAT-RISK-001 — Real-Time Position Limit Check

## Intent

Specifies the real-time position limit checking feature that prevents traders
from exceeding approved risk limits during order entry.

## Definition

### Inputs

- Current position from position-keeping system
- Proposed order (instrument, quantity, side)
- Applicable limits (trader, desk, entity level)

### Behavior

1. On order submission, calculate projected position = current + proposed
2. Check projected position against all applicable limit hierarchies
3. If any limit breached: reject order, notify risk manager
4. If within soft limit (>80%): allow but generate warning

### Outputs

- Order approved / rejected decision
- Limit utilization percentage
- Breach notification (if applicable)

## Acceptance Criteria

- [ ] Limit check completes in < 10ms (p99)
- [ ] All limit hierarchies evaluated (trader → desk → entity)
- [ ] Soft limit warnings generated at 80% utilization
- [ ] Hard limit breaches rejected with explanatory message
