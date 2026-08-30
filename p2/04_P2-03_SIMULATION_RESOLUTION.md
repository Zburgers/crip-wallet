# Agent Prompt — P2-03: Canonical Simulation + Executable Resolution + Fee Enforcement

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Consume reviewed P2-02 and produce exact executable type-2 candidate + canonical simulation evidence + exact verification + freshness result. Keep one coherent simulation authority.

## Implement
- Verify current loopback Anvil/31337 and `fixtureInstanceId`.
- Capture canonical block number/hash, pending nonce, token/native balances.
- Simulate exact transfer at bound block and normalize success/revert evidence.
- Resolve explicit nonce, type `eip1559`, gas estimate + small documented bounded margin, maxPriorityFee, maxFee, `accessList: []`.
- Enforce priority <= maxFee and `gasLimit * maxFee <= min(intent ceiling, policy ceiling)` using integer arithmetic; native balance covers max cost; never alter ERC-20 budget for gas.
- Verify every resolved field against transfer core/simulation/constraints and hash normalized simulation evidence.

## Freshness rules
Stale on noncanonical/missing/too-old block, fixture change, nonce change, token/native balance invalidation, fee/base-fee ceiling conflict, executable-field/precondition change. **A newer unrelated head alone inside freshness window remains valid.**

## Deterministic tests
Success, revert, insufficient token/native, wrong chain/public host, wrong fixture, canonical block, unrelated head stays fresh, age expiry, nonce consume, token/native drain, fee escalation, mutation of every dynamic type-2 field, accessList nonempty, native/token accounting separation. No sleep races.

## Non-goals
No signer, broadcast, migration 0022, external RPC/risk provider, native rolling budget.

## Full regression
Run install/check/audit, dev up/status, contracts, fixture, chain, DB, concurrency, invariants, cleanup plus focused P2-03 tests.

## Handoff
SHA(s), evidence/executable schemas, freshness API, gas-margin rule, counts. Verdict: `P2-03 COMPLETE — READY FOR P2-04`.
