---
id: WRK-SPEC-001
type: spec
layer: work-spec
scope: ephemeral
status: active
confidence: high
version: 1.0.0
created: 2026-03-10
updated: 2026-03-15
owner: risk-engineering-team
reviewers:
  - market-risk-sme
  - cib-architecture
activates:
  - DOM-RISK-001
  - ARCH-002
  - DOM-REG-001
dependencies:
  - id: DOM-RISK-001
    relation: constrained-by
  - id: ARCH-002
    relation: implements
tags:
  - risk
  - var
  - redesign
  - performance
---

# WRK-SPEC-001 — VaR Engine Redesign

## Problem Statement

The current VaR calculation engine fails to meet the T+0 SLA for regulatory VaR reporting as the trading book has grown beyond 50,000 positions. Batch completion times have degraded from 45 minutes to 3.5 hours, missing the 07:00 CET deadline on high-volatility days.

Additionally, the monolithic calculation pipeline cannot scale horizontally, creating a single point of failure for risk reporting.

## Proposed Change

Redesign the VaR engine as an event-driven, horizontally scalable service that:

1. **Parallelizes** VaR calculation by asset class using partitioned workers
2. **Streams** position updates via the event-driven architecture (ARCH-002) instead of batch reads
3. **Caches** intermediate results (scenario P&L vectors) to avoid redundant recalculation
4. **Maintains** full compliance with Basel III/IV VaR methodology (DOM-RISK-001)

## Knowledge Context

This specification activates the following Knowledge Artifacts:

| Activated Spec | Role in this work |
|---------------|-------------------|
| **DOM-RISK-001** (Market Risk Calculation) | Defines VaR methodology: 250-day historical simulation, confidence intervals, regulatory requirements |
| **ARCH-002** (Event-Driven Architecture) | Provides the integration pattern: position events, calculation triggers, result publication |
| **DOM-REG-001** (MiFID II Best Execution) | Risk metrics availability requirements for client reporting |

## Constraints

- VaR methodology must remain **Historical Simulation** with 250-business-day window (DOM-RISK-001, rule #1)
- All position updates must flow through the event bus (ARCH-002 compliance)
- Regulatory VaR: 10-day holding period, 99% confidence — no methodology change
- Internal VaR: 1-day holding period, 95% confidence — no methodology change
- Market data sourced exclusively from golden source (DOM-DATA-001)
- Zero downtime deployment required — cannot interrupt daily risk reporting

## Acceptance Criteria

- [ ] Regulatory VaR for 100,000 positions completes within 60 minutes
- [ ] Results available by 07:00 CET for T-1 positions (99.5% of business days)
- [ ] Horizontal scaling: 2x positions → <2x wall-clock time
- [ ] Backtesting results identical to current engine (regression suite passes)
- [ ] All 6 prescribed regulatory stress scenarios included
- [ ] Backtesting exceptions ≤ 4 per rolling 250-day window (green zone)
- [ ] Event-driven position ingestion with <5 second propagation latency

## Open Questions

1. Should we migrate to the new engine in one release or run parallel (shadow mode) first?
2. What is the caching invalidation strategy for scenario P&L vectors when market data corrects?
3. Do we need to support intraday VaR recalculation, or is end-of-day sufficient?
