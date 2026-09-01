---
id: RFC-001
type: rfc
layer: rfc
status: discussion
confidence: medium
version: 0.1.0
created: 2026-03-01
updated: 2026-03-20
owner: quantitative-research-team
reviewers:
  - market-risk-sme
  - risk-engineering-team
  - regulatory-architecture-team
dependencies:
  - id: DOM-RISK-001
    relation: extends
tags:
  - var
  - monte-carlo
  - risk
  - methodology
---

# RFC-001 — Migrate VaR Methodology from Historical Simulation to Monte Carlo

## Problem Statement

The current VaR methodology (DOM-RISK-001) relies on historical simulation with a 250-business-day observation window. This approach has known limitations:

1. **Window dependency**: VaR estimates are dominated by whether the observation window includes a stress period. A calm 250-day window produces artificially low VaR.
2. **Non-parametric tail risk**: Historical simulation cannot generate scenarios beyond observed history, underestimating tail risk for instruments with short trading histories.
3. **Correlation stability**: The method assumes correlation structures from the observation period persist, which breaks down during regime changes.

Basel III/IV's Fundamental Review of the Trading Book (FRTB) encourages Expected Shortfall over VaR, but the internal model approach still benefits from a Monte Carlo foundation that can be extended to ES.

## Proposed Change

Migrate the internal VaR calculation from historical simulation to Monte Carlo simulation:

- **Risk factor modeling**: Fit parametric distributions (Student-t, skew-normal) to historical risk factor returns.
- **Correlation structure**: Use a dynamic conditional correlation (DCC-GARCH) model instead of static historical correlations.
- **Scenario generation**: Generate 10,000 Monte Carlo scenarios per calculation cycle.
- **Regulatory VaR**: Maintain historical simulation in parallel for regulatory reporting until regulator approval of the internal model change.

## Impact Assessment

| Area | Impact |
|------|--------|
| **DOM-RISK-001** | Core methodology section requires rewrite. Confidence intervals, holding periods remain unchanged. |
| **VaR Engine (WRK-SPEC-001)** | Calculation pipeline changes from P&L lookup to scenario generation + pricing. |
| **Performance** | Monte Carlo is computationally heavier. GPU acceleration or expanded compute cluster required. |
| **Model validation** | Full model validation cycle required (6-8 months). |
| **Regulatory** | Pre-notification to regulator required. Parallel run period of minimum 12 months. |

## Alternatives Considered

1. **Filtered historical simulation**: Apply GARCH-weighted returns to historical scenarios. Partial improvement, avoids full methodology change. Rejected because it doesn't solve tail risk generation.
2. **Stress VaR overlay**: Supplement historical VaR with stressed VaR using a fixed stress window. Already implemented for regulatory purposes, but doesn't improve the base VaR methodology.

## Open Questions

1. What is the minimum parallel-run period the regulator will accept?
2. Should we adopt full repricing or Taylor expansion (delta-gamma) for scenario P&L?
3. How do we handle instruments without sufficient history for distribution fitting?
