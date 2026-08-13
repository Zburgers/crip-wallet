# WS-003 — Atomic Budget Ledger

## Objective and status

Prove the balanced budget invariant, idempotency, reservations, reconciliation
state, and transactional audit under real PostgreSQL concurrency. Status:
IN PROGRESS — local implementation and reproducible evidence complete; Gate S1
remains blocked on the wider authorization proof and independent review.

## Governing sections

Product spec 18, 19, 26, 31, 34–35; ADRs 0002, 0006, 0007, 0010, 0011;
`docs/plans/PHASE-1.md`.

## Scope and ownership

Own `packages/budget-ledger/`, `packages/audit/`, database transaction helpers,
forward migrations, and DB/concurrency/invariant tests. Out of scope: transaction
construction, network RPC, signing, approval, interfaces, dashboard, and workers
beyond ledger retry primitives.

## Dependencies and shared contracts

Consumes frozen WS-002 monetary IDs/status/events. May propose additive schema
changes through the lead; cannot modify shared contracts or lifecycle alone.

## Security invariants

- `allocated = available + reserved + finalized_spend` at every commit.
- Values are non-negative atomic integers; releases do not double-count history.
- Check and reserve share one serializable transaction/client.
- Same idempotency key/payload returns original state; different payload is a
  no-mutation conflict.
- Timeout/ambiguous signed state never releases value without proof.
- State change and audit event commit or roll back together.

## Acceptance and tests

Migration upgrade/recovery, constraints, every reservation transition, bounded
serialization retry, simultaneous oversubscription, duplicate requests, worker
retry, audit rollback/append, and generated event-sequence properties pass.
Inspect and record final database rows after concurrency runs.

## Deliverables, integration, documentation, commits

One migration commit, then one TDD commit per transaction/transition concern.
Update testing docs, risk/matrix, Phase-1 and workstream evidence. Gate S1 remains
closed until independent security review and full integrated rerun.

## Evidence

Local evidence, 2026-08-13, exact checkout
`/home/naki/Desktop/itsthatnewshit/isthisreal/crip-wallet`, branch
`phase-0/governance-foundation`, loopback PostgreSQL 17 on port 55432:

- `npm run test:db`: 11/11 tests passed. Covers forward migration checksum and
  required tables, reservation success, insufficient budget, release, expiry,
  finalization with unused release, dispute retention, bounded SQLSTATE 40001
  retry, idempotency replay/conflict, immutable policy versions/append-only
  audit, and audit rollback.
- `npm run test:concurrency`: 1/1 test passed across 32 rounds, four workers,
  ready/start/release barrier, 30-unit requests against 100 allocated. Every
  round committed exactly three reservations; final inspected state was
  `allocated=100, available=10, reserved=90, finalized_spend=0`, with three
  audit rows.
- `npm run test:invariants`: 6/6 tests passed, including the exact invariant
  across reservation, release, expiry, finalization, and dispute transitions.
- The migration lineage is forward-only: `0001_ws003_budget_ledger.sql`
  establishes the schema and `0002_ws003_idempotency_binding_guard.sql`
  permits only the transactional null-to-result binding while keeping
  idempotency identity fields immutable.

This is local technical evidence, not Gate S1 closure: approval replay,
revocation/pause fencing, integrated authorization, independent security review,
and protected CI remain outstanding.
