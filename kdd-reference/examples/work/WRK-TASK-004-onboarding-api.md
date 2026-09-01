---
id: WRK-TASK-004
type: spec
layer: work-task
scope: ephemeral
status: completed
confidence: high
version: 1.0.0
created: 2026-01-25
updated: 2026-02-10
owner: digital-channels-team
parent: WRK-PLAN-002
activates:
  - FEAT-CLIENT-001
  - ARCH-004
dependencies:
  - id: WRK-PLAN-002
    relation: implements
  - id: WRK-TASK-003
    relation: depends-on
  - id: ARCH-004
    relation: constrained-by
tags:
  - onboarding
  - api
  - implementation
---

# WRK-TASK-004 — Onboarding API

## Objective

Implement the REST API layer for the client onboarding workflow, exposing endpoints for application submission, document upload, status tracking, and compliance review.

## Implementation Notes

### REST API Endpoints

```
POST /api/v1/onboarding/applications        — Submit new onboarding application
GET  /api/v1/onboarding/applications/{id}    — Get application status
POST /api/v1/onboarding/applications/{id}/documents — Upload KYC document
GET  /api/v1/onboarding/applications/{id}/verification — Get verification status
POST /api/v1/onboarding/review/{id}          — Submit compliance review decision
```

### Security (ARCH-004)

- mTLS for service-to-service communication
- OAuth 2.0 + RBAC for portal users
- PII fields encrypted in API responses (masking for non-authorized roles)

## Acceptance Criteria

- [x] All CRUD endpoints operational with validation
- [x] Document upload supports PDF, JPG, PNG up to 10MB
- [x] API response time < 200ms for status queries
- [x] Role-based access: client view vs compliance reviewer view
- [x] OpenAPI 3.0 specification published
