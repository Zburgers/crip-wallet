# WS-005 — Approval and Controls

## Objective and status

Prove that owner approval, replay protection, revocation, pause and worker recovery cannot authorize stale work.

**Phase-1 S1 slice: COMPLETE LOCALLY.**
**Phase-3 integrated execution slice: NOT OPENED.**

## S1 contract now implemented

- Canonical authorization is the only path to protected reservation states.
- ADR-0008 local-owner authentication uses signed decision evidence bound to approval ID, approver/key identity, envelope hash, policy/version, expiry and nonce.
- Approval authentication and authorization evidence are one-time consumable and replay-protected.
- Owner secret material stays outside the database and agent-facing code; the database stores public verification material and signed evidence only.
- `SYSTEM`, `OWNER`, `AGENT` and `POLICY` control fences are authoritative and monotonic.
- Pause/revocation serializes with authorization consumers and invalidates stale authority transactionally.
- Eligible held reservations are released even when control changes occur after reservation but before envelope creation.
- Recovery lease validity uses PostgreSQL time, duration is bounded, and lease duration is authenticated in the signed claim.
- Stale workers cannot resolve after lease loss; ambiguous/conflicting outcomes remain protected/disputed.

## Evidence

At implementation head `de9cac0cc19fb17b6964074878d4916cb30899ef`:
- full DB gate 71/71;
- full concurrency gate 18/18;
- invariants 7/7;
- owner-approval focused DB proof 25/25;
- concurrent owner-approval consumption 1/1 with exactly one winner;
- WP-10 pre-envelope revoke/pause lifecycle coverage passes;
- WP-09 lease tamper/clock/bounds coverage passes.

## Remaining Phase-3 work

After WS-004 exists, re-prove these controls immediately before signing and across signed-unbroadcast, broadcast-unknown and chain-reconciliation states. That later integration is S2/Phase-3 scope; it is not a reason to keep S1 open.
