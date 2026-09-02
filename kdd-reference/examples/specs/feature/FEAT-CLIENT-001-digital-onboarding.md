---
id: FEAT-CLIENT-001
type: spec
layer: feature
domain: Client Management
subdomain: Digital Onboarding
status: draft
confidence: low
version: 0.3.0
created: 2026-03-05
updated: 2026-03-10
owner: digital-channels-team
dependencies:
  - id: DOM-CLIENT-001
    relation: implements
  - id: ARCH-004
    relation: implements
  - id: ARCH-001
    relation: implements
tags:
  - onboarding
  - digital
  - self-service
  - portal
---

# FEAT-CLIENT-001 — Digital Client Onboarding Portal

## Intent

Specifies the self-service digital onboarding portal allowing institutional
clients to initiate and track their KYC onboarding process online.

## Definition

### Features

1. **Document Upload**: Drag-and-drop with OCR extraction for KYC documents
2. **Progress Tracker**: Real-time status of onboarding stages
3. **Digital Signature**: DocuSign integration for legal agreements
4. **Screening Dashboard**: Client-visible screening status (pass/pending/escalated)
5. **Product Selection**: Self-service product enablement post-KYC approval

### Technical

- React SPA with BFF (Backend for Frontend) pattern
- Authentication via corporate SSO (SAML/OIDC)
- Document storage in encrypted S3 with 7-year retention
- Event-driven notifications (email + in-app) for status changes

## Acceptance Criteria

- [ ] Document upload with OCR reduces manual data entry by 60%
- [ ] End-to-end digital onboarding for Low-risk clients in < 3 days
- [ ] All uploaded documents encrypted at rest
- [ ] Accessibility: WCAG 2.1 AA compliance
