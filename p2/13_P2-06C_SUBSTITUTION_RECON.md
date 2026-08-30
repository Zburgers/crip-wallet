# Agent Prompt — P2-06C: Exact-Field Substitution / Evidence / Reconciliation Matrix

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
After P2-05 + P2-06A integration, add dedicated substitution/stale-state/reconciliation adversarial tests. Runs in parallel with P2-06B. P2-06D owns final root scripts/CI/docs.

## Mutate every v2 executable field
Chain, fixture, sender, target, calldata, ERC-20 recipient/amount, native value, nonce, tx type, gas limit, max priority fee, max fee, access list, simulation block number/hash; unsupported family fields. Require fail closed at correct boundary.

## Stale-state cases
Noncanonical/too-old simulation; unrelated newer head inside window remains valid; nonce consumed; token/native drain; fee/base-fee escalation; fixture reset; authorization/control fence stale before signing.

## Evidence/reconciliation attacks
Wrong tx/receipt/block/log; missing/duplicate/conflicting Transfer; operation A evidence for B; reservation/envelope cross-binding; fixture mismatch; forged reconciler; stale/duplicate/concurrent reconciliation; alternate signing attempt.

## Properties
Old authorization cannot sign any mutated field; evidence cannot cross operations; untrusted evidence cannot mutate economics without ADR-0014 auth; concurrent reconciliation one economic winner; gas/token separate; ledger invariant holds. Use property-based mutation where practical.

## Handoff
SHA(s), mutation matrix/property runs/concurrency counts/bugs. Verdict: `P2-06C COMPLETE — READY FOR P2-06D`.
