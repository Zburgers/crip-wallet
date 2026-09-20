# WS-005 — Approval and Controls

## Objective and status

Prove that owner approval, replay protection, revocation, pause and worker recovery cannot authorize stale work.

**Phase-1 S1 slice: COMPLETE LOCALLY.**
**Phase-3 integrated execution slice: IN PROGRESS; P3-01 MAX/CI/SECRET SCAN PASS; P3-02 IMPLEMENTED LOCALLY / EXACT-SHA REVIEW PENDING.**

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

## Phase-3 integrated execution plan

`docs/plans/PHASE-3.md` owns P3-00 through P3-06. It re-proves the S1 controls
at the accepted S2 execution boundary without reopening either accepted gate.

The planned invariants are:

- canonical fence-first locking and full transactional revalidation immediately
  before bounded local signing;
- one atomic signing/signed-evidence transaction, with no RPC under DB locks;
- a second full authority gate before durable broadcast `STARTED`;
- signed/no-attempt control changes quarantine to `DISPUTED`, retain value, and
  never broadcast until authenticated no-send recovery;
- `STARTED` is the send-commit point, after which pause/revocation cannot claim
  cancellation or release and exact-attempt recovery continues;
- DB-time recovery lease fencing, no new authority on retry, and one economic
  effect under crash/restart/takeover.

Accepted ADR-0018 governs the implementation. P3-01 implements the selected
R-033 resolution with a checkout-scoped Anvil mutation gateway and shared
lease held from final freshness sampling through signed-evidence commit. The
gateway is loopback-published, Anvil remains on an internal network without a
host port, and PostgreSQL is isolated on a separate bridge. P3-01 passed fresh
MAX review and exact-SHA CI/Secret Scan. P3-02 uses migrations `0027` and
`0028` for signed/no-attempt quarantine, exact-attempt recovery after control,
and replay-safe, fully auditable control requests. Static, DB 144/144, and
concurrency 18/18 pass locally; the fresh exact-SHA review/CI are pending.
P3-03 through P3-06 remain gated. Phase 3 remains local Anvil/fake-money only
and is not fully accepted.
