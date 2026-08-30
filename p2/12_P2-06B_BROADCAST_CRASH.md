# Agent Prompt — P2-06B: Broadcast / Crash / Ambiguity Matrix

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
After P2-05 + P2-06A integration, add dedicated deterministic broadcast/crash/ambiguity adversarial tests. Runs in parallel with P2-06C. Do not own final root scripts/CI/docs; P2-06D does.

## Matrix
RPC unavailable, explicit pre-accept reject, forward-then-drop, known hash/no receipt, duplicate broadcast/retry, receipt revert, stale nonce, crash before send, crash after STARTED/before send, crash after upstream send/before response, recovery retry/caller retry after uncertainty, restart with existing signed evidence/hash.

For each assert operation state, attempt classification, reservation state, expected hash, allowed retry/recovery, re-sign forbidden/allowed, economic-effect count.

## Required properties
UNKNOWN never releases; UNKNOWN never auto-resigns; response loss != definitive failure; duplicate send/recovery cannot duplicate economic spend; explicit failure releases only with authoritative pre-acceptance proof; crash recovery preserves expected hash/attempt. Use P2-06A barriers, no sleeps.

## Handoff
SHA(s), scenario->expected-state table, counts, bugs found. Verdict: `P2-06B COMPLETE — READY FOR P2-06D`.
