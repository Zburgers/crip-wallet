# WS-005 — Approval and Controls

## Objective and status

Prove that owner approval, replay protection, revocation, pause and worker recovery cannot authorize stale work.

**Phase-1 S1 slice: COMPLETE LOCALLY.**
**Phase-3 integrated execution slice: IN PROGRESS; P3-01 through P3-03 CLEARED; P3-04 locally implemented, exact-SHA review/CI pending.**

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
MAX review and exact-SHA CI/Secret Scan. P3-02 uses migrations `0027` through
`0030` for signed/no-attempt quarantine, exact ACCEPTED/UNKNOWN recovery after
control, REJECTED no-send fencing, blocked direct release/expiry after
invalidation, and replay-safe, fully auditable control requests. Local checks
pass (`npm run check` 21 + 361, DB 145/145, concurrency 18/18, invariants 7/7).
P3-02 passed fresh MAX review at 0.92 and exact-SHA CI/Secret Scan on
`b95695c720fd68dd1085e371267a35113a05c816`. P3-03 candidate
`510763b3c9c217f9058b1c9d388ce02d84e6ae9e` adds fence-first `STARTED`
authority and exact local-chain recovery. Its crash-after-send regression
reconciles a still-STARTED row once after control invalidation. Local gates
pass: check 21 repository + 363 package tests, DB 150/150, and Anvil E2E 1/1;
fresh GPT-5.6 Luna MAX review passed 9/10 (confidence 0.90, no findings).
Protected CI `35498889238` and Secret Scan `35498889228` pass on this
candidate. P3-04 through P3-06 remain gated. Phase 3 remains local
Anvil/fake-money only and is not fully accepted.

P3-04 adds migrations `0032` and `0033` for exact signed-no-attempt release
proof and authenticated lease-renewal audit. Recovery claim, renewal, takeover,
and final resolution use DB time and exact lease generations. The controlled
no-send transaction requires one bound authorization/signed row, a matching
control invalidation, and zero attempts/economic effects; it commits one
`FAILED` recovery row, `RECONCILED`/`RELEASED` state, resolved lease, and
correlated audits together. `npm run check` passes (21 repository + 363 package
tests) and `npm run test:db` passes 152/152, including concurrent duplicate
recovery and forced final-lease expiry rollback. Exact-SHA MAX review and
protected CI/Secret Scan are pending; P3-05 has not started.
