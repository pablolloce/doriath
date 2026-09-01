---
id: WRK-PLAN-001
type: spec
layer: work-plan
scope: ephemeral
status: active
confidence: high
version: 1.0.0
created: 2026-03-12
updated: 2026-03-15
owner: risk-engineering-team
parent: WRK-SPEC-001
activates:
  - DOM-RISK-001
  - ARCH-002
  - ARCH-001
dependencies:
  - id: WRK-SPEC-001
    relation: implements
  - id: ARCH-002
    relation: constrained-by
  - id: ARCH-001
    relation: constrained-by
tags:
  - risk
  - var
  - redesign
  - plan
---

# WRK-PLAN-001 — VaR Engine Redesign — Implementation Plan

## Approach

Decompose the monolithic VaR batch into an event-driven pipeline of microservices (per ARCH-001 and ARCH-002):

```
Position Events (Kafka) → Partitioner → Calculation Workers → Aggregator → Result Store
                                              │
                                    Scenario Cache (Redis)
```

**Key architectural decisions**:
- **Partition by asset class** — each worker handles one asset class (equities, FI, FX, commodities, derivatives)
- **Shared scenario cache** — historical P&L vectors cached in Redis with TTL = 1 business day
- **Shadow mode first** — run new engine in parallel with existing for 2 weeks before cutover
- **Event-driven trigger** — end-of-day market close event initiates calculation (not cron)

## Task Breakdown

| Task ID | Description | Estimated effort | Dependencies |
|---------|-------------|-----------------|-------------|
| WRK-TASK-001 | VaR Calculation Service (core engine) | 5 days | — |
| WRK-TASK-002 | VaR API Endpoint (REST + event publication) | 3 days | WRK-TASK-001 |
| WRK-TASK-003 | Position Event Consumer (Kafka → partitioner) | 3 days | — |
| WRK-TASK-004 | Scenario Cache Layer (Redis integration) | 2 days | WRK-TASK-001 |
| WRK-TASK-005 | Shadow Mode Comparator (regression validation) | 3 days | WRK-TASK-001, WRK-TASK-002 |
| WRK-TASK-006 | Performance Testing & Tuning | 2 days | All above |

## Architecture Impact

Constraints inherited from activated Knowledge Artifacts:

| Constraint | Source | Impact on plan |
|-----------|--------|---------------|
| Historical simulation, 250-day window | DOM-RISK-001 | Core algorithm unchanged — only parallelized |
| Event-driven communication | ARCH-002 | Position ingestion via Kafka, results published as events |
| Microservices patterns | ARCH-001 | Each component is an independent deployable service |
| 99% / 95% confidence intervals | DOM-RISK-001 | Calculation logic must produce both regulatory and internal VaR |
| Golden source market data | DOM-DATA-001 | No direct DB reads — consume market data events |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Numerical precision divergence in parallel calculation | Medium | High | Shadow mode comparison with tolerance threshold |
| Scenario cache invalidation race conditions | Low | Medium | TTL-based expiry + explicit invalidation on data correction events |
| Kafka consumer lag during high-volatility days | Medium | Medium | Auto-scaling consumer group + position priority queue |

## Dependencies

- **Kafka cluster** — existing, sufficient capacity confirmed with platform team
- **Redis cluster** — needs provisioning (2 replicas, 32GB per node)
- **Market data events** — already published by DOM-DATA-001 implementation
- **Shadow mode infrastructure** — dual-write to old and new result stores
