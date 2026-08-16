# WS-003 — Atomic Budget Ledger

## Objective and current status

Prove balanced integer budget accounting, reservations, idempotency and transactional audit under real PostgreSQL concurrency.

**Status: COMPLETE LOCALLY for Gate S1.**

## Governing sources

Product Spec sections 18, 19, 26, 34 and 35; ADR-0002, ADR-0006, ADR-0007, ADR-0010 and ADR-0011; `docs/plans/PHASE-1.md`.

## Security invariants

- `allocated = available + reserved + finalized_spend` at every commit.
- Monetary values are non-negative atomic integers; no floating-point money path is permitted.
- Budget check and reservation occur under one serializable transaction boundary.
- Same idempotency key + same payload returns original state; different payload fails without mutation.
- Ambiguous execution never silently releases protected funds.
- State change and audit event commit or roll back together.
- Financial audit correlation is derived from locked authoritative rows, not caller assertions.
- Authorization/broadcast/finalization cannot bypass canonical authorization evidence.

## Current evidence

At implementation head `de9cac0cc19fb17b6964074878d4916cb30899ef`:
- DB gate: 71/71 passed;
- concurrency gate: 18/18 passed, including the deterministic 32-round / 4-worker reservation proof;
- invariant/property gate: 7/7 passed;
- migration lineage: 21 forward-only checksum-locked migrations;
- WP-07 database authorization guard and explicit bypass regression are present;
- recovery/broadcast/finalization tests consume canonical authorization evidence.

Historical migration/test-count snapshots are superseded by this section and remain available in Git history. Integrated chain reconciliation is Phase 2/S2 work and is not an S1 blocker.
