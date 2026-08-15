# WS-005 — Approval and Controls

## Objective and status

Prove that approval, revocation, and pause state cannot authorize stale work.
WP-04 is COMPLETE LOCALLY for the Phase-1 database control-plane proof. Gate
S1 remains open pending independent acceptance, owner authentication, an
integrated signing/provider boundary, reconciliation, and recovery evidence.

## Governing sources

Product spec sections 19.2, 19.4, 22.2, 26.2, 34, and 35; Architecture;
Threat Model T-012; ADR-0005; Phase-1 plan; risks R-006, R-008, and R-015.

## Fencing contract

- `control_fences` is authoritative for `SYSTEM`, `OWNER`, `AGENT`, and
  `POLICY` scope state and monotonic version.
- Fence versions use PostgreSQL `bigint` with a database upper bound of
  `9007199254740991`, the JavaScript safe-integer ceiling; overflow fails
  closed.
- Approval requests, decisions, and authorization evidence persist the complete
  four-scope version/state snapshot.
- Authorization consumers and control mutations serialize in
  `SYSTEM -> OWNER -> AGENT -> POLICY` order before lifecycle/account rows.
- A committed pause/revocation appends control audit evidence and invalidates
  affected pending/authorized work in the same transaction. System pause maps
  to `REVALIDATION_REQUIRED`; owner/agent/policy revocation maps to `REVOKED`.
- Held reservations release atomically while preserving
  `allocated = available + reserved + finalized_spend`.
- Resume advances the system fence and cannot revive an old approval or
  authorization evidence row. Repeated commands are idempotent.
- `REVALIDATION_REQUIRED` is fail-closed and is not reopened automatically;
  fresh authorization proceeds through a new envelope/operation at this
  Phase-1 boundary.

## Owned implementation and evidence

- `packages/approvals/src/control.ts`
- `packages/approvals/src/index.ts`
- `packages/audit/src/index.ts`
- `packages/schemas/src/audit.ts`
- `migrations/0016_wp04_control_fences.sql`
- `tests/concurrency/control-fence.test.ts`

The focused suite has 14 deterministic tests using a ready barrier and
database-row blocker rather than sleeps. The full local DB gate passed 57/57;
the combined concurrency gate passed 16/16; invariants remained green. No
signing, broadcast, owner-key, or public-chain consumer is in this workstream.
