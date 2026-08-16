# Project State

Owner: lead orchestrator. This file is the current resume snapshot, not an activity log.

## Repository

- Repository: `Zburgers/crip-wallet`
- Working branch / PR: `phase-0/governance-foundation` / PR #1
- Governing product authority: `docs/PRODUCT_SPEC.md`
- Current implementation baseline entering WP-11: `de9cac0cc19fb17b6964074878d4916cb30899ef`

## Gate status

### S0 — PASS

The governing S0 requirements are satisfied: secret scanning, locked dependencies, CODEOWNERS, branch protection, vulnerability reporting and no real-wallet material. Ruleset `20791659` requires `validate` and protects against deletion/non-fast-forward updates.

This is a sole-maintainer repository. No separate GitHub-account approval is claimed. That limitation is tracked as R-019 and must not be described as independent human approval.

### S1 — LOCAL PASS / PROTECTED REMOTE CLOSEOUT PENDING

The governing S1 criteria are satisfied locally:
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

Full verification at `de9cac0cc19fb17b6964074878d4916cb30899ef`:
- `npm ci` PASS — 156 packages, 0 vulnerabilities;
- `npm run check` PASS — 20 repository tests + 118 package tests;
- `npm audit --audit-level=high` PASS — 0 vulnerabilities;
- local PostgreSQL/Anvil startup/status PASS — chain `0x7a69`;
- DB PASS — 71/71;
- concurrency PASS — 18/18;
- invariants PASS — 7/7;
- owner-approval focused DB PASS — 25/25;
- concurrent owner-approval consumption PASS — 1/1 with exactly one winner;
- `dev:down` PASS.

WP-11 changes protected `validate` so DB, concurrency and invariant suites are now part of the required CI check. S1 becomes fully accepted only after that current-head remote run is green.

### S2 — BLOCKED / NOT STARTED

No Phase-2 transaction construction/signing/provider/chain vertical slice is claimed yet. That work begins only after S1 closeout.

## Phase ownership

- WS-001 governance/toolchain — COMPLETE; S0 PASS.
- WS-002 canonical contracts — FROZEN LOCALLY.
- WS-003 atomic budget ledger — COMPLETE LOCALLY for S1.
- WS-005 Phase-1 S1 control slice — COMPLETE LOCALLY.
- WS-004 Phase-2 transaction pipeline/local adapter — NOT OPENED until S1.
- WS-005 Phase-3 integrated approval/control/recovery slice — NOT OPENED until WS-004 is stable.
- WS-006/007 — NOT OPENED.

## Safety boundary

No real funds, production wallet material, public RPC, testnet/mainnet, production custody or production identity is authorized by this state.

Last updated: 2026-08-16 for WP-11 closeout candidate.
