# ADR-0013: Open-source license selection

## Status

Proposed — product-owner decision required

## Context

The product is intended to be open source, but no license terms were present at
the verified baseline. Adding a license changes legal permissions and is not a
routine engineering decision.

## Decision

No license is granted by repository text until the product owner selects and
approves one. Candidate review should compare Apache-2.0, MIT, and an appropriate
copyleft option for patent protection, ecosystem adoption, contribution policy,
and hosted-service goals.

## Consequences

- A root `LICENSE` file is intentionally absent.
- README and contribution guidance must state that licensing is unresolved.
- Public contribution acceptance remains blocked until legal terms are chosen.

## Verification

- Product-owner approval, added `LICENSE`, README update, dependency license
  compatibility review, and ADR acceptance.

## Related

- Product spec sections 31 and 41.
- Risk R-018; workstream WS-001.
