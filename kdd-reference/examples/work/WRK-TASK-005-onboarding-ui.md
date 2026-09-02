---
id: WRK-TASK-005
type: spec
layer: work-task
scope: ephemeral
status: completed
confidence: high
version: 1.0.0
created: 2026-02-01
updated: 2026-02-18
owner: digital-channels-team
parent: WRK-PLAN-002
activates:
  - FEAT-CLIENT-001
dependencies:
  - id: WRK-PLAN-002
    relation: implements
  - id: WRK-TASK-004
    relation: depends-on
tags:
  - onboarding
  - ui
  - portal
  - implementation
---

# WRK-TASK-005 — Onboarding UI Portal

## Objective

Build the self-service client onboarding portal — a web application where institutional clients can initiate onboarding, upload KYC documents, track verification progress, and receive real-time status updates.

## Implementation Notes

### Key Screens

1. **Application wizard** — multi-step form with progressive disclosure (entity type → details → documents → review)
2. **Document upload** — drag-and-drop with real-time validation and OCR pre-fill
3. **Status dashboard** — timeline view of onboarding progress with estimated completion
4. **Compliance queue** — back-office view for compliance reviewers (filtered by risk category)

### UX Requirements

- Mobile-responsive (institutional clients often work from mobile for approvals)
- Accessibility: WCAG 2.1 AA compliance
- Internationalization: EN, ES, FR, DE at launch

## Acceptance Criteria

- [x] Multi-step application wizard with form validation
- [x] Document upload with drag-and-drop and progress indicator
- [x] Real-time status updates via WebSocket
- [x] Compliance reviewer dashboard with filtering and bulk actions
- [x] Onboarding completion rate improved from 62% to 87%
