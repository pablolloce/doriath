---
id: ARCH-002
type: spec
layer: architecture
status: active
confidence: high
version: 1.0.0
created: 2026-01-10
updated: 2026-02-20
owner: cib-architecture
tags:
  - event-driven
  - architecture
  - kafka
---

# ARCH-002 — Event-Driven Architecture for Trade Lifecycle

## Intent

Defines the event-driven architecture pattern used across the CIB trade lifecycle,
ensuring loose coupling, auditability, and real-time processing of trade events.

## Definition

### Context

The CIB trading platform processes millions of trade events daily. A synchronous
request-response model creates tight coupling and bottlenecks.

### Decision

Adopt an event-driven architecture using Apache Kafka as the backbone for all
trade lifecycle events (execution, confirmation, settlement, reporting).

### Rationale

- Decouples producers (trading engines) from consumers (risk, settlement, reporting)
- Provides natural audit trail via event log
- Enables real-time streaming for risk calculations
- Scales horizontally with partition-based parallelism

### Consequences

- Eventual consistency must be handled at the application level
- Event schema governance becomes critical (use Avro + Schema Registry)
- Teams must adopt idempotent consumers

## Acceptance Criteria

- [ ] All trade lifecycle events published to Kafka topics
- [ ] Event schemas registered in Confluent Schema Registry
- [ ] Consumer lag monitored with alerting threshold < 5 minutes
- [ ] Dead letter queues configured for all consumer groups
