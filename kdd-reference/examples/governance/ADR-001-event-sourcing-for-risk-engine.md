---
id: ADR-001
type: adr
layer: adr
status: accepted
confidence: high
version: 1.0.0
created: 2026-02-01
updated: 2026-03-15
owner: cib-architecture
reviewers:
  - risk-engineering-team
  - market-risk-sme
dependencies:
  - id: ARCH-002
    relation: implements
  - id: WRK-SPEC-001
    relation: depends-on
tags:
  - event-sourcing
  - risk
  - architecture-decision
---

# ADR-001 — Adopt Event Sourcing for the VaR Risk Engine

## Context

The VaR engine redesign (WRK-SPEC-001) requires a new persistence and processing model. The current batch-oriented engine reads positions from a relational snapshot, which creates coupling to upstream systems and prevents incremental recalculation.

Two patterns were evaluated:

1. **State-based persistence** — Continue writing final position state to a relational store and reading snapshots for calculation.
2. **Event sourcing** — Persist position changes as an immutable event log and derive calculation state from the stream.

The existing event-driven architecture (ARCH-002) already provides a Kafka backbone for trade lifecycle events, making event sourcing a natural extension rather than a greenfield investment.

## Decision

Adopt event sourcing as the persistence model for the VaR risk engine. All position mutations are captured as immutable events in Kafka topics, and the calculation engine derives its working state by replaying or consuming these events.

## Rationale

- **Auditability**: Regulators require full traceability of risk inputs. An immutable event log provides a built-in audit trail without additional infrastructure.
- **Incremental recalculation**: The engine can react to individual position change events instead of re-reading the entire book, enabling near-real-time VaR updates.
- **Replay and backtesting**: Historical event replay enables deterministic backtesting of VaR models against past market conditions.
- **Alignment with ARCH-002**: The CIB platform already mandates event-driven integration. Event sourcing extends this pattern to the persistence layer, reducing architectural divergence.

## Consequences

- **Eventual consistency**: VaR calculations will operate on eventually consistent state. The engine must handle out-of-order events and define a consistency boundary (end-of-day snapshot events).
- **Schema governance**: Position event schemas must be registered in the Schema Registry (Avro) with strict backward compatibility rules.
- **Storage growth**: The event log grows unbounded. A compaction strategy with daily snapshots is required to bound replay time.
- **Team skill gap**: The risk engineering team needs training on event sourcing patterns, particularly around idempotent consumers and projection management.

## Acceptance Criteria

- [ ] Position change events published to dedicated Kafka topics with Avro schemas
- [ ] VaR engine consumes position events and maintains materialized state
- [ ] Daily snapshot events enable bounded replay (< 5 min cold start)
- [ ] Event replay produces identical VaR results to batch calculation (regression suite)
