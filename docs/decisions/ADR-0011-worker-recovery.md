# ADR-0011: Database-backed worker recovery

## Status

Accepted — 2026-08-10

## Context

The local MVP needs retry and recovery but does not justify a separate queue
platform before lifecycle semantics are proven.

## Decision

Use PostgreSQL operation records as the durable work source. Workers claim jobs
with leases and fencing versions, bounded exponential backoff, explicit retry
classes, and idempotent transition handlers. Recovery scans expired leases and
ambiguous signing/broadcast states. It searches by known transaction hash and
nonce before any rebroadcast decision.

No in-memory queue is authoritative. Timeout never proves failure, and retries
never create a new reservation, approval consumption, signature, or broadcast
unless the state machine explicitly permits it.

## Alternatives considered

- Redis/BullMQ: deferred until throughput or operational evidence requires it.
- Unbounded periodic retries: rejected as unsafe and unobservable.

## Consequences

- Worker identity and fencing data are part of operation persistence.
- Ambiguous outcomes terminate in `DISPUTED` for operator review.

## Verification

- Lease race, stale worker, crash-before/after-persistence, broadcast timeout,
  duplicate delivery, and retry exhaustion tests.

## Related

- Product spec sections 19, 30, and 34.
- Risks R-004 and R-015; workstreams WS-004 and WS-005.
