# Agent Prompt — P2-05A: Persist-Before-Send Broadcast

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Implement only broadcast-attempt durability/state machine after reviewed P2-04. Runs in parallel with P2-05B and P2-06A.

## Security-critical order
Signed evidence + expected tx hash already exist -> persist `STARTED` attempt bound to operation/reservation/envelope/authorization/signed evidence/hash/fixture -> **then** `eth_sendRawTransaction`.

Classify: matching returned hash = accepted/known; explicit proven pre-acceptance reject = REJECTED candidate; timeout/transport/response loss = UNKNOWN; different/contradictory hash = CONFLICT. Generic exception never proves non-execution. Never re-sign/reconstruct due to uncertainty. Retries recover by existing expected hash/attempt identity and cannot create a second economic execution identity.

## Tests
STARTED before send, exact success, explicit reject, timeout, connection loss, wrong hash, duplicate request, crash after STARTED/before send, crash after send/unknown; UNKNOWN never releases or re-signs. Design seams for P2-06A forward-then-drop without moving authority into tests.

## Non-goals
No chain evidence acceptance, reconciler auth, economic finalize/release, fault proxy, public RPC.

## Handoff
SHA(s), state machine/durable ordering/retry contract, counts. Verdict: `P2-05A COMPLETE — READY FOR P2-05 INTEGRATION`.
