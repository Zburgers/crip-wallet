# Phase 1 — Canonical Core, Ledger and S1 Controls

**Goal:** satisfy Gate S1 without opening transaction signing, provider execution or chain integration.

## Scope

Phase 1 owns:
- canonical schemas, deterministic policy and lifecycle rules;
- atomic PostgreSQL budget ledger and idempotency;
- canonical authorization evidence;
- the local S1 approval/control slice required by the governing gate;
- local recovery-safety primitives used to prove retries and stale-worker fencing.

Phase 1 does **not** own transaction construction, signing, RPC submission, chain confirmation, provider adapters, MCP/CLI/dashboard interfaces or real funds.

## Completed work

- WS-002 canonical contracts and deterministic envelope hashing are frozen locally.
- WS-003 proves balanced integer accounting, request-bound idempotency, bounded serializable retry and deterministic concurrent reservation safety.
- WP-07 closes the alternate authorization path and adds database enforcement plus explicit bypass regression coverage.
- WP-08 implements ADR-0008 local-owner approval authentication. Approval evidence is bound to approval ID, approver/key identity, envelope hash, policy/version, expiry and nonce, and is consumed once. Private owner key material is not stored in the database or agent-facing API.
- Corrective forward migration `0021_wp08_owner_approval_auth_fix.sql` restores the persisted `authenticated_at` field required by consumption while preserving checksum-locked migration 0020.
- WP-09 uses PostgreSQL time for recovery lease validity, bounds lease duration to 300 seconds and authenticates the duration in the recovery claim.
- WP-10 closes the reservation-to-envelope revocation/pause gap and releases eligible held reservations atomically across `POLICY_FINALIZED`, `BUDGET_RESERVED`, `ENVELOPE_FINALIZED` and `AWAITING_APPROVAL`.

## Current evidence

Full clean local verification at implementation head `de9cac0cc19fb17b6964074878d4916cb30899ef`:
- `npm ci` — PASS, 156 packages, 0 vulnerabilities;
- `npm run check` — PASS, 20 repository tests + 118 package tests;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- local PostgreSQL/Anvil startup and status — PASS, chain `0x7a69`;
- `npm run test:db` — PASS, 71/71;
- `npm run test:concurrency` — PASS, 18/18;
- `npm run test:invariants` — PASS, 7/7;
- targeted owner-approval proof — PASS, 25/25 DB plus 1/1 concurrent one-winner consumption;
- `npm run dev:down` — PASS.

The migration lineage is 21 forward-only checksum-locked migrations.

## Gate S1 interpretation

The governing Product Spec defines S1 as:
- budget concurrency tests pass;
- idempotency tests pass;
- approval replay tests pass;
- revocation and pause tests pass;
- no floating-point money paths.

All five criteria are satisfied by the local implementation evidence above. Final S1 closeout additionally requires the protected current-head `validate` workflow to execute the DB, concurrency and invariant suites and pass remotely.

Integrated signing/provider/chain reconciliation is **not** an S1 prerequisite; it belongs to Phase 2 / S2 evidence.
