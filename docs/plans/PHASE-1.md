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
- WP-11 moves DB, concurrency and invariant suites into the protected `validate` workflow and reconciles gate/phase documentation with the governing Product Spec.

## Gate S1 — ACCEPTED

The governing Product Spec defines S1 as:
- budget concurrency tests pass;
- idempotency tests pass;
- approval replay tests pass;
- revocation and pause tests pass;
- no floating-point money paths.

Protected evidence head `85545348d369c7860742872acb4da100a5842152` passed CI run `31919254466` and Secret Scan run `31919254475`.

The protected CI run proved:
- `npm ci` — 156 packages installed, 0 vulnerabilities;
- repository/unit/docs checks — 20 repository tests + 118 package tests;
- dependency audit — 0 vulnerabilities;
- local PostgreSQL/Anvil startup/status — PASS, Anvil chain `0x7a69`;
- DB gate — 71/71;
- concurrency gate — 18/18 with 4 workers × 32 rounds;
- invariant/property gate — 7/7 with 512 property runs per configured seed;
- generated-state permissions and quiet signer logs — PASS;
- local runtime cleanup — PASS.

**Gate S1 is accepted. Phase 1 is complete.**

Integrated signing/provider/chain reconciliation remains Phase 2 / S2 evidence and was not used to close S1.
