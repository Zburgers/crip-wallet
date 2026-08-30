# Agent Prompt — P2-02 Integration / Review Gate

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Integrate reviewed P2-02A + P2-02BCD onto the stable P2-01 head. Do not redesign.

## Review
Verify v1 unchanged; v2 additive/domain-separated; viem only constructs; decoder imports no ABI decoder; static verifier fails closed; no early nonce/gas/fee resolution; no signer/broadcast leakage; no second transaction authority; dependency changes minimal. Resolve conflicts according to ADR-0015, not newest-file wins.

## Combined gate
Run `npm ci`, `npm run check`, audit, `npm run contracts:test`, all P2-02 focused tests, and inherited DB/concurrency/invariant tests if shared schemas/package graph can affect them. Update only truthful P2-02 checkpoint docs.

## Handoff
Return integration SHA, combined counts, audit result, final P2-03 input/output APIs. Verdict: `P2-02 COMPLETE — READY FOR P2-03` or remediation required.
