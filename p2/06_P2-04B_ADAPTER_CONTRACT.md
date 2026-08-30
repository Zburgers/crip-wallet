# Agent Prompt — P2-04B: Provider-Neutral Adapter Capability Contract

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Implement only provider-neutral adapter capability/enforcement contracts and the local-Anvil reference capability shape. Runs in parallel with P2-04A.

## Architecture
Universal boundary is `Core authorization -> authorized execution reference/capability -> adapter -> provider-specific execution`. Do **not** encode "every adapter reads Crip PostgreSQL". Local-Anvil may later use IDs-only DB loading as reference implementation.

Define minimal truthful capability/manifest/recovery/status types. Local capability exposes only an IDs-only transfer operation equivalent to `signAuthorizedTransfer({operationId, authorizationId, adapterRequestId})`. Caller-supplied transaction fields must be impossible/rejected.

Forbidden/absent: raw transaction/bytes/digest signing, `personal_sign`, typed-data, arbitrary call/target/calldata/message signing, provider-specific policy authority. Capability/enforcement claims cannot overstate support; recovery/status is not authorization.

## Tests/non-goals
Test allowed capability, forbidden methods, unsupported requests, provider-neutral types contain no PostgreSQL requirement, truthful enforcement grades. No migration, key loading, signing, RPC, budget mutation, reconciliation.

## Verify/handoff
Run install/check/audit + focused tests. Return SHA(s), exported API, forbidden-surface evidence. Verdict: `P2-04B COMPLETE — READY FOR P2-04C`.
