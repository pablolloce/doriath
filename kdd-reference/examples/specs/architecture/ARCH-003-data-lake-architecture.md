---
id: ARCH-003
type: spec
layer: architecture
status: active
confidence: medium
version: 1.0.0
created: 2026-02-01
updated: 2026-03-05
owner: data-architecture-team
dependencies:
  - id: ARCH-002
    relation: extends
tags:
  - data-lake
  - analytics
  - iceberg
  - spark
---

# ARCH-003 — Data Lake Architecture for CIB Analytics

## Intent

Defines the data lake architecture supporting regulatory reporting, risk analytics,
and business intelligence across CIB.

## Definition

### Decision

Apache Iceberg on S3 as the lakehouse format, with Spark for batch processing
and Kafka Connect for real-time ingestion from the event backbone (ARCH-002).

### Rationale

- Schema evolution without rewriting data
- Time-travel queries for regulatory point-in-time reporting
- Unified batch and streaming processing
- Cost-effective storage with S3 lifecycle policies

## Acceptance Criteria

- [ ] All trade events ingested into data lake within 15 minutes
- [ ] Point-in-time queries available for any historical date
- [ ] Data retention policies enforced per regulatory requirement
- [ ] Query performance < 30s for standard regulatory reports
