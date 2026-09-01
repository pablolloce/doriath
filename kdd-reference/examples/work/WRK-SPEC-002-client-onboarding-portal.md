---
id: WRK-SPEC-002
type: spec
layer: work-spec
scope: ephemeral
status: completed
confidence: high
version: 1.0.0
created: 2026-01-10
updated: 2026-02-20
owner: digital-channels-team
reviewers:
  - compliance-sme
  - cib-architecture
activates:
  - DOM-CLIENT-001
  - FEAT-CLIENT-001
  - ARCH-004
dependencies:
  - id: DOM-CLIENT-001
    relation: constrained-by
  - id: ARCH-004
    relation: implements
tags:
  - onboarding
  - kyc
  - client
  - portal
---

# WRK-SPEC-002 — Client Onboarding Portal

## Problem Statement

The current client onboarding process for CIB institutional clients takes an average of 23 business days, with significant manual intervention for KYC document collection, verification, and compliance checks. Clients frequently abandon the process due to repeated requests for the same information across different compliance stages.

## Proposed Change

Build a digital onboarding portal that:

1. **Centralizes** document collection via a self-service portal with progressive disclosure
2. **Automates** KYC verification using third-party identity providers and sanctions screening (DOM-CLIENT-001)
3. **Integrates** with the digital onboarding feature (FEAT-CLIENT-001) for workflow orchestration
4. **Enforces** zero-trust access patterns (ARCH-004) for sensitive client data handling

## Knowledge Context

| Activated Spec | Role in this work |
|---------------|-------------------|
| **DOM-CLIENT-001** (KYC Onboarding) | Defines KYC rules, document requirements, risk categorization |
| **FEAT-CLIENT-001** (Digital Onboarding) | Provides the workflow engine and integration patterns |
| **ARCH-004** (Security Zero Trust) | Access control patterns for client PII data |

## Constraints

- Must comply with EU AML 6th Directive requirements (DOM-CLIENT-001)
- All PII stored encrypted at rest and in transit (ARCH-004)
- Client risk categorization must be automated for standard cases
- Manual review required for enhanced due diligence (EDD) cases
- Onboarding target: ≤ 5 business days for standard risk clients

## Acceptance Criteria

- [x] Self-service portal for document upload and status tracking
- [x] Automated KYC verification for standard-risk clients < 48 hours
- [x] Sanctions screening integration with real-time results
- [x] Compliance dashboard for manual review queue
- [x] Onboarding completion rate ≥ 85% (vs current 62%)
- [x] Average onboarding time ≤ 5 business days (standard risk)
