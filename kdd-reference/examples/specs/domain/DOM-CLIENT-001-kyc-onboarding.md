---
id: DOM-CLIENT-001
type: spec
layer: domain
domain: Client Management
subdomain: KYC & Onboarding
status: active
confidence: medium
version: 1.0.0
created: 2026-02-15
updated: 2026-03-08
owner: client-lifecycle-team
dependencies:
  - id: ARCH-004
    relation: constrained-by
  - id: DOM-REG-001
    relation: constrained-by
tags:
  - kyc
  - onboarding
  - aml
  - client-lifecycle
---

# DOM-CLIENT-001 — KYC & Client Onboarding

## Intent

Defines the KYC (Know Your Customer) and onboarding rules for institutional
clients across all CIB product lines.

## Definition

### Rules

1. Client risk classification: Low / Medium / High / PEP
2. Enhanced Due Diligence (EDD) mandatory for High-risk and PEP clients
3. Document refresh: annual for High, biennial for Medium, triennial for Low
4. Sanctions screening against OFAC, EU, UN lists — real-time at onboarding, daily batch
5. Negative media screening via automated NLP-based monitoring

### Onboarding Flow

1. Client request → 2. KYC data collection → 3. Screening → 4. Risk classification
→ 5. Approval (4-eyes for High) → 6. Account setup → 7. Product enablement

## Acceptance Criteria

- [ ] Onboarding SLA: 5 days for Low, 10 days for Medium, 20 days for High
- [ ] Sanctions screening completed before any account activation
- [ ] Document refresh alerts triggered 30 days before due date
- [ ] Audit trail maintained for all KYC decisions
