# ADR-0003: Envelope lifecycle and hashing

## Status

Accepted — 2026-08-10

## Context

An execution envelope contains policy-decision and reservation identifiers, so
it cannot be immutable or hashable until those records exist. Approval and
autonomous authorization must bind to exact executable fields.

## Decision

The transaction pipeline is intent-first and never accepts agent-supplied raw
calldata for MVP transfers. It follows:

```text
validate intent -> policy precheck -> construct -> decode -> verify -> simulate
-> final policy evaluation -> atomic reservation -> finalize envelope
-> approval or autonomous authorization -> pre-sign revalidation
-> sign -> broadcast -> confirm -> reconcile
```

Pre-reservation data is an execution candidate, not an envelope. Envelopes are
append-only revisions serialized as versioned RFC 8785 JSON Canonicalization
Scheme bytes, with byte-bearing EVM fields represented as canonical lowercase
`0x` hex and integer values as base-10 strings. The envelope hash is Keccak-256
over a domain separator plus schema version and canonical bytes.

Any bound-field change supersedes the envelope and invalidates its approval or
autonomous authorization. Revalidation repeats the affected deterministic
steps. Signing never mutates or reconstructs an envelope.

## Alternatives considered

- JSON.stringify property order: rejected as insufficiently cross-runtime and
  version stable.
- EIP-712 as the internal envelope representation: deferred; it couples the
  internal record to signing semantics not required by the local MVP.

## Consequences

- Schema tests publish canonical fixtures and hash vectors.
- Envelope records require revision and supersession links.
- A retained reservation is allowed only when its bound economic fields remain
  valid; otherwise it is atomically replaced.

## Verification

- Golden canonicalization/hash vectors.
- Invalid transition and mutation tests.
- Re-simulation invalidation and approval replay tests.
- Independent construct/decode/verify integration tests.

## Related

- Product spec sections 15, 16, 19, 20, and 22.
- Risks R-005 and R-006; workstreams WS-002 and WS-004.
