# Agent Prompt — P2-06A: Deterministic Loopback RPC Fault Proxy

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Build test-only method-aware deterministic fault proxy after P2-04. May run in parallel with P2-05A/B. It owns infrastructure only, not product-state semantics.

## Network/secret rules
Proxy only current checkout-bound loopback Anvil. Reject arbitrary/non-loopback upstreams. Raw `eth_sendRawTransaction` bytes, if forwarded, stay memory-only and are redacted from logs/errors/snapshots.

## Deterministic modes
Unavailable before send; explicit RPC rejection; forward then drop response; wrong tx hash; mutated/wrong transaction; mutated/wrong receipt; withheld/delayed receipt released by explicit barrier; crash hooks before send and after upstream forward/before response; request counting/inspection where safe. Use promises/barriers/control IPC, **not sleeps**.

## Tests
Non-loopback rejection, each mode deterministic/repeatable, forward-then-drop forwards exactly once, receipt barrier controllable, cleanup reliable, no secret/raw-byte leakage, no sleep races.

## Non-goals
No broadcast classification, ledger mutation, chain-verifier decisions, signer changes.

## Handoff
SHA(s), control API/modes, counts/examples. Verdict: `P2-06A COMPLETE — READY FOR FAULT MATRICES`.
