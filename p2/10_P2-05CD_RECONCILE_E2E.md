# Agent Prompt — P2-05C/D: Authenticated Reconciliation + Clean Vertical Slice

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Integrate P2-05A/B, then reconcile only through ADR-0014 + existing lease-fenced exactly-once recovery, and prove complete local vertical slice.

## Reconciliation sequence
Verified chain result -> bind operation/reservation/envelope/expected hash/fixture -> authenticate active RECONCILER/domain payload -> acquire/verify existing recovery lease -> existing economic resolution.

Exact success finalizes ERC-20 spend once; native gas separate. Verified status-0 => token spend zero and safe release only via explicit evidence-driven existing outcome. Ambiguity/mismatch/conflict => disputed/held, never release on timeout/missing response/receipt.

## Adversarial DB/integration tests
Forged/revoked reconciler, operation A evidence for B, wrong fixture/reservation/envelope/hash, duplicate/concurrent reconciliation, stale lease, amount/log mismatch, success, verified revert, uncertain/no receipt; one economic winner and invariant preserved.

## Clean E2E
From seeded canonical intent (do not directly seed protected lifecycle): intent -> construct -> manual verify -> simulate -> final policy -> reservation -> v2 envelope -> canonical authorization -> sign -> expected hash + STARTED -> broadcast -> confirm -> verify tx/receipt/block/log -> authenticated reconciler -> exactly-once reconcile. Assert balances, native fee separation, lifecycle, reservation/finalized spend, v2 hash, authorization, expected hash, attempt, evidence, recovery, audit correlation, no secret/raw bytes.

## Handoff
Integration SHA, E2E counts, success/revert economics, concurrency/idempotency evidence, unresolved P2-06 risks. Do not claim S2. Verdict: `P2-05 COMPLETE — READY FOR P2-06 ADVERSARIAL PROOF`.
