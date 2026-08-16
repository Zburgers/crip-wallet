# ADR-0001: Provider-neutral local control plane

## Status

Accepted — 2026-08-10

## Context

Crip must preserve one deterministic authority model across wallet providers
without claiming that control-plane enforcement equals signer or on-chain
enforcement. The MVP is prohibited from using real funds.

## Decision

Core intent, policy, budget, approval, lifecycle, audit, and error contracts are
provider-neutral. Provider commands remain behind adapter interfaces. The MVP
runs only on local Anvil chain `eip155:31337`, with disposable deterministic
accounts and mock assets. No mainnet, testnet, production credential, real
wallet, raw signing, or arbitrary-call configuration is accepted.

Deterministic code, not an LLM, is the final authorization authority. Autonomous
mode means approval-free execution within all active hard limits; it never
expands or disables those limits.

## Alternatives considered

- Build directly around one wallet SDK: rejected because provider semantics
  would leak into policy and impede truthful enforcement claims.
- Use a public testnet: rejected because the MVP explicitly requires fake local
  value and deterministic failure testing.

## Consequences

- Core packages cannot import provider SDKs.
- Every adapter reports capabilities and canonical enforcement grades.
- Startup and CI must fail closed for non-local chain or RPC configuration.
- Production custody remains unsolved and must be described that way.

## Verification

- Configuration tests reject non-31337 chains and non-loopback RPC endpoints.
- Dependency and import-boundary checks keep provider SDKs out of core.
- E2E evidence uses only disposable Anvil state and mock assets.

## Related

- Product spec sections 2, 6, 7, 8, 12, 13, and 35.
- Risks R-001 and R-002; workstreams WS-002 and WS-004.
