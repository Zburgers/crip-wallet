# WS-003 — Atomic Budget Ledger

## Objective and status

Prove the balanced budget invariant, idempotency, reservations, reconciliation
state, and transactional audit under real PostgreSQL concurrency. Status:
COMPLETE LOCALLY — the Phase-1 ledger proof and integration review are complete;
Gate S1 remains blocked on the wider authorization proof, protected CI, and
independent review acceptance.

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
- Timeout/ambiguous signed state never releases value without adapter-recorded,
  receipt/hash/nonce evidence independently transitioned to `VERIFIED` by the
  reconciler boundary; disputed value remains reserved.
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

- `npm run test:db`: 25/25 tests passed. Covers twelve forward migrations and
  checksum drift recovery, concurrent migration runners, failed-legacy-audit
  fail-closed recovery, transactional DDL rollback, reservation success,
  insufficient budget, release, expiry, authorization, pending/verified
  evidence-gated broadcast, finalization with unused release, disputed retention
  without evidence, bounded and real PostgreSQL SQLSTATE 40001 retry,
  request-bound idempotency replay/conflict, concurrent worker retries,
  response-loss replay, operation-to-budget binding, typed full-event audit
  verification and row-bound database hash guard, immutable evidence/policy
  versions/append-only audit, and audit rollback.
- `npm run test:concurrency`: 1/1 test passed across 32 rounds, four workers,
  ready/start/release barrier, 30-unit requests against 100 allocated. Every
  round committed exactly three reservations; final inspected state was
  `allocated=100, available=10, reserved=90, finalized_spend=0`, with three
  audit rows.
- `npm run test:invariants`: 7/7 tests passed, including lifecycle properties and
  generated accounting/event sequences with seed `2026081303` and 512 runs.
- The migration lineage is forward-only: `0001_ws003_budget_ledger.sql`
  establishes the schema, `0002_ws003_idempotency_binding_guard.sql` permits only
  the transactional null-to-result binding, `0003_ws003_reservation_broadcast_audit.sql`
  adds the reviewed broadcast audit event, `0004_ws003_evidence_and_binding_guards.sql`
  adds evidence and ownership/policy binding fences, `0005_ws003_audit_hash_guard.sql`
  adds the persisted canonical-payload guard, `0006_ws003_audit_hash_domain_fix.sql`
  corrects the database byte-domain implementation, `0007_ws003_evidence_verification.sql`
  adds pending/verified reconciliation and evidence immutability,
  `0008_ws003_audit_row_binding_guard.sql` binds the payload to row columns,
  `0009_ws003_audit_legacy_fail_closed.sql` refuses legacy rows without a
  compatibility backfill, `0010_ws003_parent_binding_guards.sql` protects
  operation/budget ownership fields, and `0011_ws003_pending_evidence_default_fix.sql`
  plus `0012_ws003_evidence_guard_column_fix.sql` harden the evidence migration
  path. The applied migration ledger contains all twelve `sha256:` checksums.
- The final inspected `budget_1` row was
  `allocated=100, available=10, reserved=90, finalized_spend=0, version=3`,
  with three held 30-unit reservations, three reservation audit rows, and no
  broadcast-evidence rows. Ambiguous `DISPUTED` reservations remain reserved and
  cannot be finalized by this phase. `BROADCAST` and `FINALIZED` rows require
  adapter-recorded evidence with a canonical transaction hash, nonce, and receipt
  reference. Only a reconciler worker can transition it to `VERIFIED`, and only
  verified evidence can release funds; the external adapter authentication and
  chain-reconciliation gate remains a Gate S1 concern.
- Final `schema_migrations` inspection recorded six rows and checksums:
  `0001_ws003_budget_ledger.sql` =
  `sha256:38e12fafca92d680d2d173580a03bffad7dbc216f66703a4b1e0f2e1b7c08fa6`,
  `0002_ws003_idempotency_binding_guard.sql` =
  `sha256:eef5eefc9ed49cc71bbf424b8cf1293e308d2b3ebd996129b7023653a007481d`,
  `0003_ws003_reservation_broadcast_audit.sql` =
  `sha256:79d2d5543af6f24d52cfa9d43d3ffd8d8c273314b123ccc91521d1406868a336`,
  `0004_ws003_evidence_and_binding_guards.sql` =
  `sha256:9557c717c5a147722476c30f49641c593de2230f872057019bc0f5b4af017ee3`,
  `0005_ws003_audit_hash_guard.sql` =
  `sha256:dc76e1f665b18b0b82c1321d39a63978f20f1aa8a1876ce25a97bd64ab548cfa`,
  and `0006_ws003_audit_hash_domain_fix.sql` =
  `sha256:109a49dbf3351a2ffa3575f5d0cf0b83ba5156c961ef4ac00eb415668acf2c5e`,
  `0007_ws003_evidence_verification.sql` =
  `sha256:5d90277112181cdd0d380e942ae41b69cc580456290ae64b3a48de04cad3e44a`,
  `0008_ws003_audit_row_binding_guard.sql` =
  `sha256:1337e8dc915596f989874b4b3589fce6cb15e315f84295a891419a3fcf8a5a8f`,
  `0009_ws003_audit_legacy_fail_closed.sql` =
  `sha256:7f9f5e1550b9c68061d2511d20cdffaec6e2dff2137d89cc38a82692ac10815c`,
  `0010_ws003_parent_binding_guards.sql` =
  `sha256:d12835bbd1d4f33777425d68547838e8e5579f742902e7356fd1a8239c11b5c1`,
  `0011_ws003_pending_evidence_default_fix.sql` =
  `sha256:c87f877e3b51988adf12c63ff976cbd561c3d21648fd5f0abf5be17c46360a7f`,
  and `0012_ws003_evidence_guard_column_fix.sql` =
  `sha256:15cde144d905ae28cca6b686d9af99e7d21e8c402146f03fd4b73306826d4dd8`.

This is local technical evidence, not Gate S1 closure: approval replay,
revocation/pause fencing, integrated authorization, independent security review,
and protected CI remain outstanding.
