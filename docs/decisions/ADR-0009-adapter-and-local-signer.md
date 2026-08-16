# ADR-0009: Adapter contract and local signer boundary

## Status

Accepted — 2026-08-10

## Context

Future providers have different custody and enforcement properties, while the
MVP requires only a disposable local signer.

## Decision

The adapter SDK exposes capability discovery, wallet identity, simulation,
sign authorization, broadcast, status, receipt normalization, revocation
fencing, and health. Core passes only a finalized authorized envelope; adapters
never receive policy-authoring authority.

The local Anvil adapter runs in a process boundary separate from agent-facing
interfaces. Anvil writes deterministic disposable account material to ignored
`.local/` state at startup; the adapter reads only the assigned test account.
No method returns private keys or general signing. The manifest truthfully marks
MVP rules `CONTROL_PLANE` unless the adapter itself proves stronger enforcement.

## Alternatives considered

- Embed a raw private key in API configuration: rejected as an unrestricted
  signing path.
- Implement future provider adapters now: rejected as speculative scope.

## Consequences

- Safe, MetaMask, Turnkey, Privy, Coinbase, and WalletConnect implementations
  can conform later without changing core policy contracts.
- The local adapter is never evidence of production custody safety.

## Verification

- Adapter conformance fixtures, capability-grade tests, signer isolation tests,
  no-secret output tests, and local chain integration tests.

## Related

- Product spec sections 13.3, 23, 28, and 42.
- Risks R-001 and R-012; workstream WS-004.
