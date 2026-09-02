---
id: WRK-TASK-007
type: spec
layer: work-task
scope: ephemeral
status: active
confidence: high
version: 1.0.0
created: 2026-02-25
updated: 2026-03-15
owner: market-data-team
parent: WRK-PLAN-003
activates:
  - DOM-DATA-001
  - FEAT-DATA-001
dependencies:
  - id: WRK-PLAN-003
    relation: implements
  - id: WRK-TASK-006
    relation: depends-on
  - id: DOM-DATA-001
    relation: constrained-by
tags:
  - market-data
  - normalization
  - implementation
---

# WRK-TASK-007 — Data Normalization Engine

## Objective

Implement the normalization layer that transforms raw provider-specific tick data into the canonical market data model defined in DOM-DATA-001, applying quality rules and source hierarchy logic.

## Implementation Notes

### Normalization Pipeline

1. **Parse** raw tick into provider-specific model
2. **Map** to canonical model (symbol mapping, currency conversion, field alignment)
3. **Validate** against quality rules (stale data detection, outlier filtering, crossed markets)
4. **Enrich** with derived fields (mid-price, spread, VWAP)
5. **Publish** normalized tick to distribution topic

### Quality Rules (from DOM-DATA-001)

- Stale price detection: >30s for FX, >60s for equities, >300s for fixed income
- Outlier filter: tick > 5% deviation from rolling VWAP triggers review
- Source hierarchy: Bloomberg > Refinitiv > Direct feed (configurable per asset class)

## Acceptance Criteria

- [ ] All provider formats normalized to canonical model
- [ ] Quality rules applied with <5ms overhead per tick
- [x] Source hierarchy resolution for multi-provider instruments
- [ ] Derived field calculation (mid, spread, VWAP)
- [ ] Normalization throughput: 500K ticks/second
