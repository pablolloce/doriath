---
id: PROD-FX-001
type: spec
layer: product
domain: Markets & Trading
subdomain: FX
status: active
confidence: high
version: 1.1.0
created: 2026-02-01
updated: 2026-03-05
owner: fx-product-team
dependencies:
  - id: DOM-TRADE-001
    relation: implements
  - id: DOM-DATA-001
    relation: uses-data-from
  - id: DOM-RISK-001
    relation: constrained-by
  - id: DOM-CLIENT-001
    relation: depends-on
tags:
  - fx
  - spot
  - forward
  - product
---

# PROD-FX-001 — FX Spot & Forward Product

## Intent

Defines the FX Spot and Forward product specification including pricing model,
execution rules, and settlement conventions.

## Definition

### Product Features

- **Spot**: T+2 settlement, all major and minor currency pairs
- **Forward**: Up to 2Y tenor, custom fixing dates
- **NDF**: Non-deliverable forwards for restricted currencies (CNY, BRL, INR)

### Pricing

- Spot mid from golden source + spread matrix by client tier
- Forward points derived from interest rate differential
- Markup: Platinum < 0.5bp, Gold < 1bp, Standard < 2bp

### Execution

- Auto-pricing for notional < USD 10M
- RFQ workflow for > USD 10M with manual override
- Pre-trade risk check: FX exposure limit per client

## Acceptance Criteria

- [ ] Spot pricing latency < 10ms from market data tick
- [ ] Forward points curve calibrated every 15 minutes
- [ ] NDF fixing rates sourced from WM/Reuters benchmark
- [ ] All FX trades reported per MiFID II / EMIR requirements
