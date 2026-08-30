# Agent Prompt — P2-02A: Envelope V2 + Hash Dispatch

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Implement only additive envelope v2 and deterministic version/hash dispatch. This runs in parallel with P2-02BCD.

## Requirements
- Freeze v1 exactly: `schemaVersion: "1.0"`, hash-preimage `v1`, parsing, persistence meaning, golden vectors.
- Add v2: `schemaVersion: "2.0"`, hash-preimage `v2`; dispatch by version, do not redefine a shared v1 literal.
- Bind all unsigned EIP-1559 execution fields: chain/from/to/value/calldata, resolved nonce, `transactionType: "eip1559"`, gas limit, max priority fee, max fee, `accessList: []`, simulation block number/hash, plus existing decision/reservation/policy/expiry/risk/approval/authorization provenance.
- Unsupported transaction families/fields fail closed.

## TDD evidence
Prove old v1 vectors unchanged; v1/v2 domain separation; deterministic v2 vectors; missing/unknown-field rejection; nonempty access list rejection; legacy/blob/authorization-list rejection; unsafe integer/hex/address rejection; mutation of every bound field changes hash or fails validation.

## Ownership / non-goals
Own envelope schema/hash files and direct tests. Do not add viem, transaction-pipeline, live simulation, migration 0022, signer, broadcast, or reconciliation.

## Verify
`npm ci`, `npm run check`, `npm audit --audit-level=high`, all focused v1/v2 tests.

## Handoff
Return commit SHA(s), files, focused counts, explicit v1-unchanged statement, v2 field list. Verdict: `P2-02A COMPLETE — READY FOR P2-02 INTEGRATION` or blocked reason.
