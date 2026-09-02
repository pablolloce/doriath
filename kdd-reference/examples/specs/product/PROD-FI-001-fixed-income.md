---
id: PROD-FI-001
type: spec
layer: product
domain: Markets & Trading
subdomain: Fixed Income
status: draft
confidence: medium
version: 0.5.0
created: 2026-03-01
updated: 2026-03-09
owner: fi-product-team
dependencies:
  - id: DOM-TRADE-001
    relation: implements
  - id: DOM-RISK-001
    relation: constrained-by
  - id: DOM-DATA-001
    relation: uses-data-from
  - id: DOM-SETTLE-001
    relation: constrained-by
tags:
  - fixed-income
  - bonds
  - rates
  - credit
---

# PROD-FI-001 — Fixed Income Trading Product

## Intent

Defines the fixed income trading product covering government bonds, corporate
credit, and money market instruments.

## Definition

### Product Scope

- **Government Bonds**: G10 sovereigns, emerging market hard currency
- **Corporate Credit**: IG and HY bonds, CDS
- **Money Markets**: Repos, CP, CD, T-Bills

### Pricing

- Government bonds: real-time spread to benchmark
- Corporate credit: bid/ask from market-making desk + automated pricing for liquid names
- Repos: overnight and term rates benchmarked to SOFR/ESTR

### Risk Constraints

- Duration limit per desk (DV01 basis)
- Credit concentration limits per issuer
- Repo haircut tables per collateral type

## Acceptance Criteria

- [ ] Government bond pricing updated real-time during market hours
- [ ] Corporate credit auto-pricing for top 200 issuers
- [ ] Repo margin calls calculated intraday
- [ ] Position P&L attributed by risk factor (rates, credit, FX)
