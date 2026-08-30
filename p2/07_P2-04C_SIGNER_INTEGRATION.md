# Agent Prompt — P2-04C: Restricted Local Signer + P2-04 Integration

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Integrate P2-04A + P2-04B, then implement high-risk restricted local-Anvil signer.

## Signer
Separate local process boundary; IDs-only request; authenticate component where required; load current envelope/reservation/authorization/fixture from trusted state; verify disposable sender; reject v1; sign exact v2 type-2 fields including `accessList: []`. Immediately before signing recheck canonical authorization, fences, expiry, fixture, simulation freshness, nonce, token/native balances, fee ceiling. Derive expected tx hash and persist allowed signed evidence; raw bytes stay inside signer/broadcast boundary.

## Secret rules
No key/raw signed bytes in argv, env, logs/errors, API, audit, fixture, repo, snapshots. No network-exposed signer. Use repository-consistent local IPC/secret channel and test it.

## Adversarial tests
Caller raw fields, wrong key/sender/chain/fixture, v1, malformed v2, nonempty access list, stale approval/fence/expiry/nonce/simulation/balances/fee, revoked component, crash before/after durable signed evidence, stdout/stderr/audit leak scans. Stale/mutated bound field => no signature.

## Integration/regression
Prove signer cannot manufacture lifecycle state or bypass canonical authorization. Do not broadcast. Run full inherited local gates + signer/adapter tests.

## Handoff
Integration SHA, IPC model, IDs-only API, persisted signed-evidence shape, expected-hash contract, test counts. Verdict: `P2-04 COMPLETE — READY FOR P2-05 AND P2-06A`.
