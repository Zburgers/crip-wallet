# Agent Prompt — P2-04A: Execution-Evidence Migration / DB Guards

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Implement only forward persistence/DB validation needed by the final P2-02/P2-03 contracts. Runs in parallel with P2-04B.

## Migration
Add forward `0022_ws004_evm_execution_evidence.sql` (or repository-consistent equivalent). Never edit 0001-0021. Version-dispatch envelope DB validation: exact v1 preserved, exact v2 added, unknown version fails closed.

Persist only required evidence: current local fixture identity, simulations, signed evidence without raw bytes/key, broadcast attempts, normalized chain transaction/receipt/log evidence. **Do not create generic persistent `transaction_candidates`** unless a demonstrated recovery requirement forces escalation.

## Constraints/tests
Prevent v1/v2 confusion, invalid v2/access list, cross-operation/reservation/envelope evidence, stale fixture, duplicate hash economic identities, mutable signed evidence, invalid attempt transitions, multiple economic effects. Test migration ordering/checksum, old v1 DB records, valid/invalid v2, cross-binding attacks, duplicate hashes, immutability, atomic rollback.

## Non-goals
No adapter capability API, key loading, signing, RPC send, chain verifier, reconciliation decision logic.

## Verify/handoff
Run install/check/audit + DB/concurrency/invariants. Return migration/checksum, schema/constraints/repos, counts and APIs for P2-04C/P2-05. Verdict: `P2-04A COMPLETE — READY FOR P2-04C`.
