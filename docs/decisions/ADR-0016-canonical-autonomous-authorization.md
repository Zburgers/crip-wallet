# ADR-0016 - Canonical Autonomous Authorization

**Status:** Proposed

**Date:** 2026-08-31

## Context

The Product Spec requires autonomous-within-policy execution. The policy engine already persists an immutable `ALLOW_AUTONOMOUS` decision, but the Phase-1 authorization writer and schema are intentionally owner-approval-specific: they require `REQUIRE_APPROVAL`, a consumed approval request, and an approver. Manufacturing that evidence for an autonomous action would erase the distinction between human approval and policy authority.

Downstream signer, invalidation, signed-evidence, broadcast, and reconciliation records already use `authorization_evidence` as the canonical execution-authority identity. A second unrelated authority root would complicate every security guard and create cross-type race and uniqueness problems.

## Problem

There is no legitimate production transition from an immutable `ALLOW_AUTONOMOUS` decision to exactly one envelope-bound authorization and `AUTHORIZED` lifecycle state. P2-05D cannot bypass this absence by directly inserting protected state.

## Decision

1. Forward migration `0024` will generalize `authorization_evidence` into the single canonical execution-authorization root by adding `authorization_kind` with exactly `OWNER_APPROVAL` and `AUTONOMOUS_POLICY`.
2. Existing rows are classified as `OWNER_APPROVAL` without changing their IDs, bindings, validity, or approval semantics. `REQUIRE_APPROVAL` continues to require a real approved and consumed approval request.
3. Approval-specific fields become conditionally nullable under a database-enforced exclusive-shape constraint. `OWNER_APPROVAL` requires the existing approval, approver, consumption, and decision bindings. `AUTONOMOUS_POLICY` forbids approval and approver fields and requires an immutable `ALLOW_AUTONOMOUS` policy decision. It creates no approval request, owner signature, approval decision, or consumed approval.
4. Common fields remain mandatory for both kinds: authorization ID, operation, reservation, envelope ID/revision/hash, policy decision ID/hash, policy ID/version, issuance and expiry, and the system/owner/agent/policy fence versions and states captured at issuance.
5. Add a production `authorizeAutonomous` service. Its caller supplies identifiers only. The service reloads authoritative rows in one transaction, in the repository's canonical fence lock order, and accepts only a persisted `ALLOW_AUTONOMOUS` decision whose hash, policy version, operation, reservation, current envelope, and fixture-bound execution identity all agree.
6. The writer requires the operation and reservation to be in their canonical pre-authorization states, the reservation to be `HELD`, the envelope to be the latest immutable revision and unexpired, all four fences to be current and active, the policy and credentials to be active, and no canonical authorization to exist or have been superseded.
7. The transaction atomically inserts the authorization, advances the legitimate operation/reservation state through their existing transition writers, and appends correlated audit evidence. Caller-provided transaction fields, policy results, fence values, expiry values, or authorization kind are never authority.
8. A database uniqueness constraint permits at most one canonical authorization per operation/current envelope. The autonomous and approval writers take the same serialization locks so concurrent duplicate writers are idempotent only for an exact request and otherwise fail closed. An owner-approval/autonomous race cannot create two winners.
9. `authorization_invalidations` continues to reference the same authorization root. Existing pause, revocation, fence-change, envelope-supersession, credential, and expiry invalidation machinery applies equally to both kinds. Control queries must stop assuming every authorization has an approval request.
10. Pre-sign revalidation dispatches only the evidence-specific check: owner authorizations revalidate the real approval; autonomous authorizations revalidate the immutable `ALLOW_AUTONOMOUS` decision. Both kinds then pass the same or stronger envelope, reservation, policy, credential, fixture, nonce, simulation, balance, fee, expiry, and four-fence checks.

## Trust boundaries

- The persisted policy decision and its canonical hash are authority; a caller statement that an action is autonomous is not.
- PostgreSQL constraints and the transactional writer protect uniqueness, binding, and race behavior.
- The local signer consumes only the canonical authorization projection and independently reloads current hard controls.
- Audit is evidence, not authorization authority.

## Persistence model

- Extend `authorization_evidence` with `authorization_kind` and a strict mutually exclusive evidence-shape check.
- Preserve all existing primary keys and downstream foreign keys.
- Make approval-only columns nullable only as required for `AUTONOMOUS_POLICY`; retain their existing requirements for `OWNER_APPROVAL` in constraints and triggers.
- Generalize the authorization-binding trigger to dispatch by kind while preserving the existing owner-approval checks exactly.
- Add no second authorization ID namespace and no caller-writable compatibility view.

## Retry and concurrency semantics

- An exact retry returns the already-created canonical authorization after rechecking its full binding.
- A retry with a different decision, envelope, reservation, policy version, or fence snapshot conflicts.
- Duplicate and cross-kind writers serialize on the same operation/reservation/envelope rows. Exactly one authorization may win.
- Invalidation may race issuance or signing; canonical lock ordering and signer revalidation ensure a stale winner cannot sign.

## Security invariants

- Only persisted `ALLOW_AUTONOMOUS` may create `AUTONOMOUS_POLICY` authorization.
- Autonomous authorization applies to one immutable envelope and one reservation only.
- It never fabricates human evidence and never downgrades `REQUIRE_APPROVAL` or `DENY`.
- It bypasses none of the hard policy, budget, simulation, fee, fixture, credential, expiry, pause, revocation, or fence controls.
- Both authorization kinds participate in the same invalidation and exactly-once execution boundaries.

## Alternatives considered

### Separate autonomous authorization table

Rejected. It creates two authority roots, dual signer/control queries, awkward downstream foreign keys, cross-table ID/one-winner constraints, and divergent invalidation behavior.

### Generic parent with typed child tables

Not selected for the MVP. It is conceptually clean but requires migrating every downstream trigger/query and maintaining additional one-to-one child invariants. The explicit-kind design achieves the same semantic distinction with materially lower migration risk.

### Fabricate or auto-approve an approval request

Rejected. It falsely attributes autonomous policy authority to a human and weakens audit meaning.

## Migration implications

- Use only forward migration `0024`; migrations `0001` through `0023` and their checksums remain unchanged.
- Upgrade tests start at the exact `0023` schema, insert representative owner-approval evidence, apply `0024`, and prove that evidence and all downstream references remain valid.
- The migration must fail closed on invalid mixed shapes and forged direct insertion.

## Test requirements

- Reject `REQUIRE_APPROVAL`, `DENY`, stale policy/envelope, mismatched hashes/reservation, changed or inactive fences, pause/revocation, inactive policy, expiry, and forged insertion.
- Prove exact retry, duplicate and concurrent autonomous writers, and approval/autonomous race behavior.
- Prove invalidation before signing and policy/fence change after authorization fail at pre-sign revalidation.
- Keep all existing owner-approval and migration-upgrade suites green.

## Non-goals

- No public-network, production-custody, new owner identity, new policy mode, or interface work.
- No change to envelope v1/v2 hashing or approval semantics.
- No implementation or acceptance claim is made by this Proposed ADR.

## Relationship to existing ADRs

This extends ADR-0003, ADR-0005, ADR-0008, ADR-0010, ADR-0012, ADR-0014, and ADR-0015. ADR-0015 is not rewritten. If accepted, this ADR supplies the missing canonical autonomous authority consumed by its signer boundary.

