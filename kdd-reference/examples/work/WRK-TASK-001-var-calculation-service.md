---
id: WRK-TASK-001
type: spec
layer: work-task
scope: ephemeral
status: active
confidence: high
version: 1.0.0
created: 2026-03-13
updated: 2026-03-15
owner: risk-engineering-team
parent: WRK-PLAN-001
activates:
  - DOM-RISK-001
dependencies:
  - id: WRK-PLAN-001
    relation: implements
  - id: DOM-RISK-001
    relation: constrained-by
tags:
  - risk
  - var
  - calculation
  - implementation
---

# WRK-TASK-001 — VaR Calculation Service

## Objective

Implement the core VaR calculation service that computes Value at Risk for a given set of positions and historical market data. This is the computational heart of the redesigned engine.

The service receives a partition of positions (by asset class), retrieves or computes historical P&L scenarios, and returns VaR metrics at the specified confidence levels.

## Implementation Notes

### Algorithm (from DOM-RISK-001)

1. Retrieve 250-business-day historical market data for relevant risk factors
2. For each historical day, compute hypothetical P&L for each position
3. Sort the P&L distribution
4. Extract percentiles: 1st percentile (99% VaR) and 5th percentile (95% VaR)
5. Scale 1-day VaR to 10-day using square-root-of-time rule for regulatory VaR

### Service Interface

```
Input:
  - positions: Position[]          (partitioned by asset class)
  - historicalData: MarketData[]   (250 business days)
  - params: { holdingPeriod: 1|10, confidenceLevel: 0.95|0.99 }

Output:
  - var: number                    (VaR amount)
  - contributionByPosition: Map<PositionId, number>
  - scenarioPnL: number[]          (full distribution for backtesting)
```

### Patterns to follow

- **Hexagonal architecture** (ARCH-001): calculation logic in domain layer, no infrastructure dependencies
- **Stateless service**: all state comes from inputs — enables horizontal scaling
- **Deterministic**: same inputs → same outputs — critical for shadow mode comparison

## Acceptance Criteria

- [ ] Computes 1-day 95% VaR (internal) correctly against reference test vectors
- [ ] Computes 10-day 99% VaR (regulatory) correctly against reference test vectors
- [ ] Handles all 5 asset classes: equities, fixed income, FX, commodities, derivatives
- [ ] Returns position-level VaR contribution for attribution
- [ ] Processes 20,000 positions (single partition) within 12 minutes
- [ ] Pure domain logic — no database or messaging dependencies in core module
- [ ] Unit test coverage ≥ 95% for calculation module

## Test Plan

1. **Unit tests**: reference VaR vectors from regulatory test packs (Basel III CRR)
2. **Property-based tests**: VaR monotonicity (more positions → higher VaR), diversification benefit (portfolio VaR ≤ sum of individual VaRs)
3. **Regression tests**: compare output against current engine for 1,000 real position snapshots
4. **Performance tests**: benchmark with 20K, 50K, 100K positions per partition
