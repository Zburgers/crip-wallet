# Agent Prompt — P2-05B: Verify Untrusted Transaction / Receipt / Block / Transfer Evidence

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Implement only pure/typed verification of untrusted local-chain evidence against trusted expected execution. Runs in parallel with P2-05A/P2-06A.

## Verify
Against operation/reservation/envelope v2/current fixture/expected hash, match tx hash, chain/fixture, from/to/input/value/nonce/type/gas/maxPriority/maxFee/accessList semantics; receipt hash/status/block consistency; canonical included block; exactly expected fake-token `Transfer` contract/sender/recipient/amount. One canonical included Anvil block is local evidence only. Status 0 => zero token spend; native fee separate. Wrong/missing/malformed/conflicting evidence fails closed.

Output typed verified evidence/mismatch codes. It is **not** an authenticated reconciler credential and must not mutate budget state.

## Mutation tests
Wrong hash/from/to/calldata/value/nonce/type/gas/fees/access list/fixture/block; missing receipt; status 0; wrong/missing/duplicate Transfer; operation-A evidence for B; malformed RPC objects.

## Non-goals
No send/STARTED persistence/signing/reconciler auth/economic mutation.

## Handoff
SHA(s), verified-evidence type, mismatch list, counts. Verdict: `P2-05B COMPLETE — READY FOR P2-05 INTEGRATION`.
