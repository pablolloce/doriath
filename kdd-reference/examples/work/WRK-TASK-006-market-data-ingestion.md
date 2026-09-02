---
id: WRK-TASK-006
type: spec
layer: work-task
scope: ephemeral
status: completed
confidence: high
version: 1.0.0
created: 2026-02-12
updated: 2026-03-01
owner: market-data-team
parent: WRK-PLAN-003
activates:
  - DOM-DATA-001
dependencies:
  - id: WRK-PLAN-003
    relation: implements
  - id: DOM-DATA-001
    relation: constrained-by
tags:
  - market-data
  - ingestion
  - implementation
---

# WRK-TASK-006 — Market Data Ingestion Adapters

## Objective

Build the ingestion layer that connects to multiple market data providers, receives raw tick data, and publishes it to the internal event bus for downstream normalization.

## Implementation Notes

### Provider Adapters

| Provider | Protocol | Asset Classes |
|----------|----------|---------------|
| Bloomberg B-PIPE | Proprietary API | All |
| Refinitiv Elektron | WebSocket (RSSL) | Equities, FI |
| ICE Data Services | FIX 4.4 | Derivatives, Commodities |
| Direct exchange feeds | FIX 5.0 SP2 | Equities (LSE, Euronext) |

### Adapter Pattern

Each adapter implements a common interface:
- `connect()` — establish provider connection with auth
- `subscribe(symbols[])` — subscribe to instrument updates
- `onTick(callback)` — raw tick callback
- `healthCheck()` — connection liveness probe

## Acceptance Criteria

- [x] Bloomberg adapter operational with B-PIPE subscription
- [x] Refinitiv adapter with automatic reconnection
- [x] ICE FIX adapter with session management
- [x] Health monitoring with automatic failover
- [x] Throughput: 200K ticks/second per adapter instance
