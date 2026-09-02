---
id: WRK-PLAN-002
type: spec
layer: work-plan
scope: ephemeral
status: completed
confidence: high
version: 1.0.0
created: 2026-01-12
updated: 2026-02-18
owner: digital-channels-team
parent: WRK-SPEC-002
activates:
  - DOM-CLIENT-001
  - FEAT-CLIENT-001
  - ARCH-004
  - ARCH-001
dependencies:
  - id: WRK-SPEC-002
    relation: implements
  - id: ARCH-001
    relation: constrained-by
tags:
  - onboarding
  - kyc
  - plan
---

# WRK-PLAN-002 — Client Onboarding Portal — Implementation Plan

## Approach

Three-phase delivery aligned with compliance milestones:

1. **KYC Verification Service** — core verification engine with sanctions screening
2. **Onboarding API** — REST endpoints for portal and back-office integration
3. **Onboarding UI** — self-service portal for institutional clients

## Task Breakdown

| Task ID | Description | Estimated effort | Dependencies |
|---------|-------------|-----------------|-------------|
| WRK-TASK-003 | KYC Verification Service | 5 days | — |
| WRK-TASK-004 | Onboarding API | 4 days | WRK-TASK-003 |
| WRK-TASK-005 | Onboarding UI Portal | 5 days | WRK-TASK-004 |

## Architecture Impact

| Constraint | Source | Impact on plan |
|-----------|--------|---------------|
| AML 6th Directive compliance | DOM-CLIENT-001 | KYC rules engine must encode all regulatory checks |
| Zero-trust access | ARCH-004 | mTLS between services, RBAC for portal access |
| Microservices patterns | ARCH-001 | Each component independently deployable |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Third-party KYC provider SLA misses | Medium | High | Multi-provider fallback strategy |
| Regulatory requirement changes during build | Low | High | Rule engine externalized for rapid updates |
