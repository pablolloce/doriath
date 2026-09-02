---
id: DOC-API-001
type: spec
layer: documentation
domain: Markets & Trading
subdomain: API
status: active
confidence: high
version: 2.0.0
created: 2026-02-01
updated: 2026-03-08
owner: api-platform-team
dependencies:
  - id: DOM-TRADE-001
    relation: implements
  - id: DOM-TRADE-002
    relation: implements
  - id: ARCH-001
    relation: constrained-by
  - id: ARCH-004
    relation: constrained-by
tags:
  - api
  - openapi
  - trading
  - rest
  - documentation
---

# DOC-API-001 — Trading API Documentation & Contract

## Intent

Defines the external-facing Trading API contract including endpoints, authentication,
rate limits, and versioning strategy.

## Definition

### API Surface

| Endpoint | Method | Description |
|----------|--------|-------------|
| /orders | POST | Submit new order |
| /orders/{id} | GET | Get order status |
| /orders/{id} | DELETE | Cancel order |
| /executions | GET | List executions (filtered) |
| /positions | GET | Current positions |
| /market-data/snapshot | GET | Latest prices |

### Authentication & Security

- OAuth 2.0 client credentials flow
- API keys with per-client rate limiting
- Rate limit: 1,000 req/min (standard), 10,000 req/min (premium)

### Versioning

- URL-based versioning: `/v2/orders`
- Breaking changes require new major version
- Deprecation notice: 6 months before retirement

## Acceptance Criteria

- [ ] OpenAPI 3.1 spec published and auto-generated from code
- [ ] API sandbox available for client testing
- [ ] Rate limiting enforced with clear 429 response headers
- [ ] API changelog published with every release
