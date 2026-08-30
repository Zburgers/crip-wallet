# Agent Prompt — P2-02B/C/D: Construct + Independently Decode + Verify Transfer Core

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Implement one coherent static contract: canonical transfer intent -> exact ERC-20 calldata -> independent manual decode -> static verification. Runs in parallel with P2-02A.

## Dependency
Create `packages/transaction-pipeline/**`. Select and lock one reviewed exact `viem` version; audit it. Do not add ethers/Hardhat/second ABI library. Avoid envelope files owned by P2-02A.

## Constructor
Use `viem.encodeFunctionData` only for `transfer(address,uint256)`. Trusted inputs: canonical intent, trusted sender, trusted fake-token address, `eip155:31337`, current `fixtureInstanceId`. Target is token, native value zero. Keep nonce as strategy/provenance only. Do not invent resolved nonce/gas/fees/simulation. Ignore caller symbol/decimals as authority.

## Independent decoder
No ABI encoder/decoder imports. Accept exactly 68 bytes, selector `0xa9059cbb`, canonical zero-left-padded address word, uint256 amount; reject malformed padding/hex, trailing bytes, unknown selector, opaque/general/multicall data. Typed failure codes.

## Static verifier
Compare chain, sender, token target, action/selector, recipient, amount, exact calldata, native value, nonce strategy/provenance, fixture identity, and available operation/intent/policy provenance. Never coerce mismatch to success.

## Tests
Mutation/property corpus: selector, short/long/trailing data, odd/malformed hex, nonzero address padding, recipient, amount, target, sender, chain, fixture, native value, arbitrary/multicall data, uint256 edges. Constructor and decoder must genuinely use separate implementations.

## Non-goals
No simulation, resolved nonce/gas/fees, final envelope, migration, signing, broadcast, reconciliation.

## Verify/handoff
Run `npm ci`, `npm run check`, audit, focused tests. Return SHA(s), exact viem version, API, mutation/property counts. Verdict: `P2-02BCD COMPLETE — READY FOR P2-02 INTEGRATION`.
