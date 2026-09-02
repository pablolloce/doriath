---
id: WRK-TASK-002
type: spec
layer: work-task
scope: ephemeral
status: draft
confidence: medium
version: 1.0.0
created: 2026-03-14
updated: 2026-03-15
owner: risk-engineering-team
parent: WRK-PLAN-001
activates:
  - ARCH-002
  - DOM-REG-001
dependencies:
  - id: WRK-PLAN-001
    relation: implements
  - id: WRK-TASK-001
    relation: depends-on
  - id: ARCH-002
    relation: constrained-by
tags:
  - risk
  - var
  - api
  - implementation
---

# WRK-TASK-002 — VaR API Endpoint

## Objective

Implement the REST API and event publication layer for VaR results. This task exposes the calculation service (WRK-TASK-001) to consumers: the risk dashboard, regulatory reporting pipeline, and downstream event subscribers.

## Implementation Notes

### REST API

```
GET  /api/v1/var/portfolio/{portfolioId}
     ?date={YYYY-MM-DD}
     &holdingPeriod={1|10}
     &confidenceLevel={0.95|0.99}

Response:
{
  "portfolioId": "...",
  "date": "2026-03-14",
  "var": 1800000,
  "holdingPeriod": 10,
  "confidenceLevel": 0.99,
  "currency": "EUR",
  "contributions": [
    { "positionId": "...", "var": 280000, "weight": 0.156 }
  ],
  "metadata": {
    "calculatedAt": "2026-03-15T06:45:00Z",
    "scenarioCount": 250,
    "positionCount": 52341
  }
}
```

### Event Publication (ARCH-002)

After each calculation run, publish a `VarCalculationCompleted` event to the risk topic:

```json
{
  "type": "VarCalculationCompleted",
  "portfolioId": "...",
  "date": "2026-03-14",
  "regulatoryVar": 1800000,
  "internalVar": 410000,
  "positionCount": 52341,
  "completedAt": "2026-03-15T06:45:00Z"
}
```

### Patterns to follow

- **Event-driven architecture** (ARCH-002): results published as domain events, not just stored
- **API standards**: RESTful, versioned, consistent error responses
- **MiFID II compliance** (DOM-REG-001): risk metrics must be available for client reporting within T+1

## Acceptance Criteria

- [ ] REST endpoint returns VaR for a given portfolio, date, and parameters
- [ ] Response includes position-level contribution breakdown
- [ ] `VarCalculationCompleted` event published to Kafka after each run
- [ ] API response time < 500ms for cached results
- [ ] API versioned (v1) with standard error responses
- [ ] Authentication via service token (internal API)
- [ ] OpenAPI specification generated and published

## Test Plan

1. **Integration tests**: API endpoint → calculation service → mock market data → response validation
2. **Contract tests**: OpenAPI spec compliance (request/response schema)
3. **Event tests**: verify Kafka event published with correct schema after calculation
4. **Load tests**: 50 concurrent API requests with cached results
