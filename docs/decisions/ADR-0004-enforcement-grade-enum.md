# ADR-0004: Canonical enforcement-grade enum

## Status

Accepted — 2026-08-10

## Context

Casing and delimiter variants can create unsafe comparisons and misleading UI.

## Decision

All schemas, database constraints, adapter manifests, APIs, telemetry, fixtures,
tests, and UI logic use exactly:

```text
ONCHAIN | SIGNER | CONTROL_PLANE | ADVISORY | UNSUPPORTED
```

Ordering is strongest to weakest as written. Parsing is strict; aliases and
case-folding are rejected at trust boundaries. UI may render explanatory labels
but the underlying value remains canonical.

## Alternatives considered

- Normalize arbitrary input: rejected because silent coercion can hide contract
  drift.
- Numeric storage only: rejected because raw values are hard to inspect and can
  drift from public schemas.

## Consequences

- PostgreSQL uses an enum or check constraint with these exact tokens.
- Capability comparison uses one shared total-order function.

## Verification

- Schema, persistence round-trip, comparison, manifest, API, and UI fixture tests.
- Lowercase and unknown values must be negative cases.

## Related

- Product spec sections 6.7, 10, 17, and 23.
- Risk R-007; workstreams WS-002 and WS-004.
