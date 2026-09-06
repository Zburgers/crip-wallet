# Project State

Owner: lead orchestrator.
Update rule: at every meaningful integration point; keep this as the current resume snapshot rather than an activity log.

## Repository

- Repository: `Zburgers/crip-wallet`
- Current default branch: `main` at Phase-2 merge commit `2c7e50f6aee6887ddd4af74c7bc33639707451b4`
- Phase 0/1 merge: PR #1 merged as `4dd91b481ccac51247e2c7e1220b5e74f968c0d5`
- Phase 2 / WS-004 merge: PR #5 merged to `main` as `2c7e50f6aee6887ddd4af74c7bc33639707451b4`
- Historical Phase-2 integration branch: `phase-2/ws-004-local-erc20`
- External S2 acceptance review: `5126373971`
- Final Phase-2 main-merge review: `5126534096`
- Governing product authority: `docs/PRODUCT_SPEC.md`
- Phase-1 protected evidence head: `85545348d369c7860742872acb4da100a5842152`
- Phase-1 protected CI: run `31919254466` — PASS
- Phase-1 Secret Scan: run `31919254475` — PASS
- Phase-2 post-merge `main` CI: run `34058182763` — PASS
- Phase-2 post-merge `main` Secret Scan: run `34058183008` — PASS

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

### S2 — PASS / ACCEPTED

Phase 2 / WS-004 is complete, externally reviewed, S2-accepted, and merged to `main` for the governing local fake-ERC-20 MVP boundary:

`construct → independently verify → simulate → authorize → locally sign → broadcast → confirm → reconcile`

ADR-0015 is accepted and fixes the exact EIP-1559 envelope-v2, local reference-signer, persist-before-send broadcast, and authenticated reconciliation boundary. ADR-0016 and ADR-0017 are also accepted.

P2-01 through P2-06D are implemented, externally reviewed and integrated. S2 requirement evidence is PASS; external S2 acceptance is PASS / ACCEPTED in review `5126373971`. PR #17 was merged into the Phase-2 branch at `34e0b53af07abff20fc36a737c17d6b0107e57bc`; PR #5 was then main-merge reviewed in `5126534096` and merged to `main` as `2c7e50f6aee6887ddd4af74c7bc33639707451b4`.

The actual post-merge `main` candidate passed CI `34058182763` and Secret Scan `34058183008`, including the clean E2E, fault, adversarial, DB, concurrency, invariant, signer-state/leakage and cleanup gates.

**Gate S2 is PASS / ACCEPTED, and Phase 2 / WS-004 is COMPLETE / ACCEPTED for the local boundary.**

## Dependency state

- The merged `main` carries `@types/node` `26.2.0`, `@types/pg` `8.23.1`, `eslint` `10.9.1`, `typescript-eslint` `8.68.0`, and `@noble/hashes` `2.4.0`; the full protected Phase-2 merge-ref and post-merge `main` CI passed with those versions.
- TypeScript remains pinned at `6.0.3`; Vitest remains `4.1.10` for the accepted Phase-2 boundary.
- TypeScript 7 and Vitest 5 remain outside this Phase-2 acceptance and require separate dependency/compatibility review before adoption.
- R-020 remains monitored through Dependabot and dependency-audit CI.

## Phase ownership

- WS-001 governance/toolchain — COMPLETE; S0 PASS.
- WS-002 canonical contracts — FROZEN LOCALLY.
- WS-003 atomic budget ledger — COMPLETE; S1 accepted.
- WS-005 Phase-1 S1 control slice — COMPLETE; S1 accepted.
- WS-004 Phase-2 transaction pipeline/local adapter — P2-06D COMPLETE / ACCEPTED; Phase 2 / WS-004 COMPLETE / ACCEPTED / MERGED TO `main`.
- WS-005 Phase-3 integrated approval/control/recovery slice — NOT OPENED.
- WS-006/007 — NOT OPENED.

## Safety boundary

Phase 2 remains strictly local and fake-money only: Anvil chain `31337` / `0x7a69`, disposable local keys and a mock ERC-20. Public RPC, testnet, mainnet, real funds, production custody and production identity remain prohibited.

## Phase-2 closeout handoff

- `docs/plans/PHASE-2.md` contains the accepted architecture, APIs, lifecycle mapping, migration impact, packet-level TDD tasks, fault model, threat ownership and S2 reproduction gate.
- ADR-0015 is **ACCEPTED**. Envelope v2 uses schema version `2.0` and a distinct v2 hash-preimage version; binds all unsigned type-2 fields including `accessList: []`; uses bounded simulation-freshness rules; preserves the local-Anvil IDs-only signer as a reference-adapter mechanism rather than a universal DB-coupling requirement; persists expected transaction hash/broadcast attempt before send; and keeps ADR-0014 authenticated reconciler evidence in front of exactly-once ledger reconciliation.
- P2-01 through P2-06D and the complete external review lineage are recorded in `docs/TEST_MATRIX.md` and PR #5.
- S2 requirement evidence is PASS; external S2 acceptance is PASS / ACCEPTED in review `5126373971`; final Phase-2 main-merge review is `5126534096`; PR #5 merged to `main` as `2c7e50f6aee6887ddd4af74c7bc33639707451b4`.
- Phase 3 remains NOT OPENED. Opening it requires an explicit new planning decision; Phase-2 acceptance does not widen the local-only safety boundary.

Last updated: 2026-09-07 for the post-merge Phase-2 / S2 closeout.
