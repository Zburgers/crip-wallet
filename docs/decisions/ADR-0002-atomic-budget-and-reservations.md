# ADR-0002: Atomic budget accounting and reservations

## Status

Accepted — 2026-08-10

## Context

The draft accounting equation included historical adjustments in current value,
which could double-count releases. Concurrent and retried requests must never
overspend.

## Decision

For one agent-wallet-asset-policy-version account, all values are non-negative
atomic integers and the committed invariant is:

```text
allocated = available + reserved + finalized_spend
```

Releasing or expiring a reservation transfers the same amount from `reserved`
to `available`. Finalization transfers the actual spend from `reserved` to
`finalized_spend` and releases any unused reserved asset amount. Historical
events remain append-only evidence but are not another current-balance term.

PostgreSQL serializable transactions, explicit constraints, unique idempotency
records, and bounded retry on serialization failure form the MVP concurrency
mechanism. One node-postgres client owns each `BEGIN`/`COMMIT` or `ROLLBACK`
boundary. No autonomous authorization is exposed until the proof suite passes.

## Alternatives considered

- Row locks at read-committed isolation: viable but easier to apply
  inconsistently across new paths.
- SQLite locking: rejected because the repository has no evidence it satisfies
  the required concurrent workload.
- Historical adjustments in the live equation: rejected as ambiguous.

## Consequences

- Allocation changes require an owner-authorized policy version and balanced
  ledger posting.
- Ambiguous signed/broadcast outcomes remain reserved or disputed; timeout alone
  never releases value.
- Database constraints duplicate critical application invariants.

## Verification

- Unit transition-table tests.
- PostgreSQL transaction and constraint tests.
- Deterministic concurrent reservation tests.
- Property tests over valid event sequences.
- Idempotency conflict and serialization retry tests.

## Related

- Product spec sections 18, 26, 34, and Gate S1.
- Risks R-003 and R-004; workstream WS-003.
