# ADR-0013: Open-source license selection

## Status

Accepted — 2026-08-14

## Context

The product is intended to be open source. The repository needs a permissive
license that supports adoption and contributions without imposing reciprocal
distribution obligations. The project has not identified a patent-specific
licensing requirement, and this decision does not authorize real-value or
production deployment.

## Decision

The repository is licensed under the MIT License. MIT is the smallest safe
permissive choice for this local-only MVP: it is widely understood, compatible
with the current dependency set, and does not create a copyleft obligation.
The copyright holder is `Zburgers`. If a future production or patent-protection
requirement makes MIT insufficient, a superseding ADR is required before that
scope is added.

## Consequences

- A root `LICENSE` file contains the canonical MIT text and package metadata
  declares SPDX identifier `MIT`.
- README and contribution guidance identify the MIT License.
- This decision closes the license-selection blocker; it does not waive the
  required PR review, security review, or local-only/fake-money constraints.

## Verification

- Added `LICENSE`, package metadata, README/contribution updates, and the
  dependency license review recorded in the Phase-0 evidence. The ADR and
  decision index are accepted together with this change.

## Related

- Product spec sections 31 and 41.
- Risk R-018; workstream WS-001.
