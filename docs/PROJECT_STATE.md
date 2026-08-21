# Project State

Owner: lead orchestrator.
Update rule: at every meaningful integration point; keep this as the current resume snapshot rather than an activity log.

## Repository

- Repository: `Zburgers/crip-wallet`
- Default branch baseline: `main` at `f733a41ed16c44ad631f0a5a4b52e8096ab70eed`
- Phase 0/1 merge: PR #1 merged as `4dd91b481ccac51247e2c7e1220b5e74f968c0d5`
- Phase-2 implementation branch: `phase-2/ws-004-local-erc20`
- Governing product authority: `docs/PRODUCT_SPEC.md`
- Phase-1 protected evidence head: `85545348d369c7860742872acb4da100a5842152`
- Phase-1 protected CI: run `31919254466` — PASS
- Phase-1 Secret Scan: run `31919254475` — PASS

## Gate status

### S0 — PASS

The governing S0 requirements are satisfied: secret scanning, locked dependencies, CODEOWNERS, branch protection, vulnerability reporting and no real-wallet material. The protected `main` branch remains the integration boundary.

This is a sole-maintainer repository. No separate GitHub-account approval is claimed. That limitation is tracked as R-019 and must not be described as independent human approval.

### S1 — PASS / ACCEPTED

The governing S1 criteria are satisfied and protected remotely:
- budget concurrency — PASS;
- idempotency — PASS;
- approval replay protection — PASS;
- revocation/pause proof — PASS;
- integer-only money — PASS.

WP-07 through WP-10 close the external-review blockers:
- canonical authorization cannot be manufactured through the old alternate ledger path;
- ADR-0008 local-owner decisions are authenticated and one-time consumable;
- recovery lease validity uses DB time, bounded authenticated duration and stale-worker fencing;
- control changes catch held reservations between reservation and envelope creation.

Forward migration `0021_wp08_owner_approval_auth_fix.sql` corrects the missing `authenticated_at` projection without modifying checksum-locked migration 0020.

Protected CI run `31919254466` at `85545348d369c7860742872acb4da100a5842152` passed the complete WP-11 merge gate:
- install/check/audit — PASS, 20 repository + 118 package tests, 0 vulnerabilities;
- local PostgreSQL/Anvil startup/status — PASS, chain `0x7a69`;
- DB — 71/71;
- concurrency — 18/18, including 4 workers × 32 rounds;
- invariants — 7/7, configured property runs 512;
- runtime permissions / quiet signer logs — PASS;
- cleanup — PASS.

**Phase 1 is complete and Gate S1 is accepted.**

### S2 — OPEN / NOT PASSED

Phase 2 / WS-004 is now open for the local fake-ERC-20 vertical slice:

`construct → independently verify → simulate → authorize → locally sign → broadcast → confirm → reconcile`

No S2 evidence is claimed yet. Transaction construction, independent decoding, simulation/fee enforcement, local signing/broadcast/confirmation/reconciliation and chain-level fault/ambiguity tests remain to be implemented and proven.

## Dependency state

- `typescript-eslint` is `8.67.0` and `@types/node` is `26.2.0`; their Dependabot PRs passed protected CI and Secret Scan before merge.
- TypeScript remains pinned at `6.0.3`.
- Dependabot PR #2 for TypeScript 7.0.2 is intentionally ignored for the TypeScript 7 major line because `typescript-eslint@8.67.0` requires TypeScript `<6.1.0`; its CI fails closed at `npm ci` with `ERESOLVE`.
- R-020 remains monitored through Dependabot and dependency-audit CI.

## Phase ownership

- WS-001 governance/toolchain — COMPLETE; S0 PASS.
- WS-002 canonical contracts — FROZEN LOCALLY.
- WS-003 atomic budget ledger — COMPLETE; S1 accepted.
- WS-005 Phase-1 S1 control slice — COMPLETE; S1 accepted.
- WS-004 Phase-2 transaction pipeline/local adapter — implementation plan complete; P2-01 ready.
- WS-005 Phase-3 integrated approval/control/recovery slice — NOT OPENED until WS-004 is stable.
- WS-006/007 — NOT OPENED.

## Safety boundary

Phase 2 remains strictly local and fake-money only: Anvil chain `31337` / `0x7a69`, disposable local keys and a mock ERC-20. Public RPC, testnet, mainnet, real funds, production custody and production identity remain prohibited.

## Phase-2 planning handoff

- `docs/plans/PHASE-2.md` now contains the researched architecture, APIs, lifecycle mapping, migration impact, packet-level TDD tasks, fault model, threat ownership and S2 reproduction gate.
- P2-01 is ready to implement against the existing checkout-bound Anvil runtime.
- P2-02 and later are blocked on explicit acceptance of proposed ADR-0015. The accepted envelope v1 cannot bind every field of the exact EIP-1559 transaction that Phase 2 must sign.
- S2 remains **OPEN / NOT PASSED**; no runtime Phase-2 implementation or chain evidence exists yet.

Last updated: 2026-08-21 for the Phase-2 implementation-plan handoff.
