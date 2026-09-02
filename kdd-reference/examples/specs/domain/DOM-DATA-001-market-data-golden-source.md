---
id: DOM-DATA-001
type: spec
layer: domain
domain: Markets & Trading
subdomain: Market Data
status: active
confidence: medium
version: 1.0.0
created: 2026-02-01
updated: 2026-02-28
owner: data-architecture-team
dependencies:
  - id: ARCH-002
    relation: implements
tags:
  - market-data
  - golden-source
  - pricing
---

# DOM-DATA-001 — Market Data Golden Source

## Intent

Establishes the single authoritative source for market data (prices, rates, indices)
consumed by risk, trading, and reporting systems across CIB.

## Definition

### Rules

1. All market data consumers must source from the golden source API
2. Data freshness: real-time for liquid instruments, T-1 EOD for illiquid
3. Vendor hierarchy: Bloomberg > Reuters > ICE for price disputes

## Acceptance Criteria

- [ ] Single API endpoint serves all market data consumers
- [ ] Data freshness SLA: < 500ms for real-time, available by 06:00 CET for EOD
- [ ] Vendor fallback chain implemented and tested
