---
id: WRK-TASK-008
type: spec
layer: work-task
scope: ephemeral
status: draft
confidence: medium
version: 1.0.0
created: 2026-03-10
updated: 2026-03-15
owner: market-data-team
parent: WRK-PLAN-003
activates:
  - FEAT-DATA-001
  - ARCH-002
dependencies:
  - id: WRK-PLAN-003
    relation: implements
  - id: WRK-TASK-007
    relation: depends-on
  - id: ARCH-002
    relation: constrained-by
tags:
  - market-data
  - websocket
  - distribution
  - implementation
---

# WRK-TASK-008 — WebSocket Distribution Gateway

## Objective

Build the distribution gateway that delivers normalized market data to internal consumers via WebSocket connections, supporting subscription-based filtering, snapshot+updates pattern, and connection management.

## Implementation Notes

### Distribution Model

- **Topic-based subscriptions**: clients subscribe to symbols/asset classes
- **Snapshot + updates**: on subscribe, send latest snapshot then stream deltas
- **Conflation**: configurable per-client (real-time for trading, 1s conflation for dashboards)
- **Back-pressure**: slow consumers get conflated updates, not disconnected

### Connection Management

- Connection limit: 500 concurrent WebSocket connections
- Authentication: JWT token with symbol-level entitlements
- Heartbeat: 10s ping/pong with automatic cleanup of stale connections

## Acceptance Criteria

- [ ] WebSocket server supporting 200+ concurrent consumers
- [ ] Subscription-based filtering by symbol and asset class
- [ ] Snapshot + updates pattern operational
- [ ] Conflation modes: real-time, 100ms, 1s
- [ ] End-to-end latency <100ms from normalized tick to client delivery
- [ ] Graceful degradation under load (conflation, not disconnection)
