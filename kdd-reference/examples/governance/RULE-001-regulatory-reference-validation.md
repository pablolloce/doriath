---
id: RULE-001
type: rule
layer: rule
status: active
confidence: high
version: 1.0.0
created: 2026-02-15
updated: 2026-03-10
owner: regulatory-architecture-team
dependencies:
  - id: DOM-REG-001
    relation: constrained-by
tags:
  - validation
  - regulatory
  - governance
---

# RULE-001 — Regulatory Domain Specs Must Include Regulatory Reference

## Intent

Ensures that all domain specifications dealing with regulatory requirements include a traceable reference to the specific regulation, directive, or standard they formalize. Without this, specs risk becoming disconnected from the legal obligations they represent.

## Rule Definition

**Every domain spec** where `subdomain` contains "Regulatory", "Compliance", or "Regulation", **or** where `tags` include `regulation`, `regulatory`, or `compliance`, **must** include a `regulatory_reference` field in its YAML frontmatter.

The `regulatory_reference` field must contain:

- The official regulation identifier (e.g., "MiFID II", "EMIR", "Basel III")
- The specific article or section when applicable

## Validation Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Regulatory reference validation",
  "description": "Enforces regulatory_reference on regulatory domain specs",
  "if": {
    "anyOf": [
      { "properties": { "subdomain": { "pattern": "(?i)(regulatory|compliance|regulation)" } } },
      { "properties": { "tags": { "contains": { "enum": ["regulation", "regulatory", "compliance"] } } } }
    ]
  },
  "then": {
    "required": ["regulatory_reference"],
    "properties": {
      "regulatory_reference": {
        "type": "string",
        "minLength": 3,
        "description": "Official regulation identifier and article/section"
      }
    }
  }
}
```

## Examples

**Compliant** (DOM-REG-001):
```yaml
subdomain: MiFID II
tags: [mifid, regulation, best-execution]
regulatory_reference: "MiFID II — Directive 2014/65/EU, Articles 27-28"
```

**Non-compliant** (missing field):
```yaml
subdomain: EMIR Reporting
tags: [emir, regulation]
# regulatory_reference is missing → validation fails
```

## Acceptance Criteria

- [ ] Validation rule integrated into `spec-graph validate` pipeline
- [ ] All existing regulatory domain specs pass the rule
- [ ] CI pipeline fails if a new regulatory spec omits the field
