# ADR-0014: Authenticated local execution evidence and recovery

## Status

Accepted — 2026-08-15 for the local Phase-1 proof

## Context

`actorType = adapter` and `actorId` prefixes describe an event but do not
authenticate the component that produced execution or reconciliation evidence.
Retries also need durable ownership and fencing without opening the Phase-2
signing or public-chain surface.

## Decision

Phase 1 provisions Ed25519 public keys in the PostgreSQL
`trusted_component_credentials` table. Adapter and reconciler processes retain
their private key outside the agent-facing path and sign canonical,
domain-separated action payloads. The application verifies the active credential,
component identity, role, action, and payload before accepting an action.
Broadcast and verification evidence persist the credential ID, component ID,
role, signature, and signed-payload hash as immutable identity evidence.

Recovery uses a PostgreSQL lease with a monotonic version and an append-only,
unique attempt ID. A stale or simultaneous worker cannot resolve the operation.
Duplicate attempts return the original result. Matching authenticated evidence
may be verified and finalized once; an authoritative pre-broadcast failure may
release; AMBIGUOUS and CONFLICT outcomes remain DISPUTED and keep funds held.

This authenticates the local component boundary, not a real chain receipt or
production custody. No transaction signing, RPC, testnet, mainnet, or real-fund
surface is added by this decision.

## Alternatives considered

- Actor labels alone: rejected because they are caller-controlled metadata.
- Shared HMAC secret: rejected because key distribution and component
  attribution are weaker at this boundary.
- Provider or chain signatures: deferred to Phase 2 and outside Gate S1 local
  proof scope.

## Verification

`tests/db/wp05-recovery.test.ts` covers unauthenticated and impersonated
callers, authenticated components, response loss, crash windows, duplicate and
simultaneous recovery, stale workers, conflicting evidence, protected funds,
and exactly-once finalization.

## Related

ADR-0009, ADR-0010, ADR-0011, ADR-0012; Threat Model T-004, T-018, T-019, and
T-021; risks R-004, R-008, R-015, and R-017; WS-005.
