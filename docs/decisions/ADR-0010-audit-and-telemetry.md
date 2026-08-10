# ADR-0010: Audit and lifecycle telemetry

## Status

Accepted — 2026-08-10

## Context

Every authorization and financial transition must be observable without leaking
credentials or treating telemetry as an authorization source.

## Decision

Audit events are append-only PostgreSQL records written transactionally with the
state change they describe. Each event carries stable actor, owner, agent,
wallet, intent, operation, policy version, and trace identifiers. Event payloads
are typed and redacted. A per-stream hash chain provides tamper evidence but does
not replace database access control or backups.

OpenTelemetry spans follow the lifecycle from request through reconciliation.
Tracing, metrics, and logs are asynchronous evidence consumers; their failure
must be visible but must not mutate authorization decisions. Secret and signed
transaction bytes are prohibited attributes.

## Alternatives considered

- Logs as the audit system: rejected because log delivery is not transactional.
- Global total-order hash chain: deferred; it creates unnecessary write
  contention for the single-wallet MVP.

## Consequences

- State repositories accept an audit writer within the same transaction.
- Hash algorithm and canonical payload schema are versioned.

## Verification

- Transaction rollback, append-only permission, correlation completeness,
  redaction, hash-chain, and telemetry-failure tests.

## Related

- Product spec sections 26.3 and 29.
- Risks R-013 and R-014; workstreams WS-003 and WS-007.
