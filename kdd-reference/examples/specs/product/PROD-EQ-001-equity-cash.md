---
id: PROD-EQ-001
type: spec
layer: product
domain: Markets & Trading
subdomain: Equities
status: active
confidence: medium
version: 1.0.0
created: 2026-02-15
updated: 2026-03-08
owner: equities-product-team
dependencies:
  - id: DOM-TRADE-001
    relation: implements
  - id: DOM-TRADE-002
    relation: implements
  - id: DOM-SETTLE-001
    relation: constrained-by
  - id: DOM-DATA-001
    relation: uses-data-from
tags:
  - equities
  - cash
  - dma
  - algo
---

# PROD-EQ-001 — Equity Cash Trading Product

## Intent

Specifies the equity cash trading product covering DMA, algorithmic,
and high-touch execution across global exchanges.

## Definition

### Execution Modes

- **DMA** (Direct Market Access): Client order routed directly to exchange
- **Algo**: VWAP, TWAP, Implementation Shortfall, Liquidity Seeking
- **High-Touch**: Sales trader managed, voice/chat originated

### Venue Coverage

- Primary exchanges: NYSE, NASDAQ, LSE, Euronext, XETRA, TSE
- Dark pools: UBS MTF, Turquoise, CBOE BXTR
- Systematic internalisers where beneficial for client

### Commission Model

- DMA: 1.5bps, Algo: 2.5bps, High-Touch: 5bps
- Volume discounts at 3-month rolling tiers

## Acceptance Criteria

- [ ] DMA latency < 100μs to exchange gateway
- [ ] Algo engines achieve VWAP within 2bps of benchmark
- [ ] Transaction cost analysis (TCA) report generated T+1
- [ ] Best execution evidence per MiFID II RTS 28
