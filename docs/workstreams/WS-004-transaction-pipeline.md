# WS-004 — Transaction Pipeline and Local Anvil Adapter

**Phase:** 2

**Status:** OPEN / P2-03 COMPLETE LOCALLY; P2-04 NEXT; ADR-0015 ACCEPTED; S2 NOT PASSED

**Dependency:** Gate S1 — PASS / ACCEPTED

**Governing plan:** `docs/plans/PHASE-2.md`

## Ownership contract

WS-004 owns the first complete local chain-execution proof for Crip Wallet. Its purpose is to connect the already-proven canonical intent, policy, authorization and budget primitives to one restricted fake-ERC-20 execution path on Anvil.

The workstream must preserve the existing provider-neutral control-plane model. The local Anvil adapter is a reference implementation, not a license to introduce provider-specific authority into core packages or to require every future provider adapter to access Crip's database directly.

## In scope

- mock ERC-20 contract and deterministic local fixture;
- transaction construction from canonical intent;
- independent transaction decode/verification;
- state-changing simulation;
- gas/native-fee estimation and ceilings separated from token budget;
- immutable execution-envelope finalization;
- local adapter capability declaration and enforcement checks;
- local signer isolation and redaction;
- local broadcast/confirmation/receipt verification;
- reservation reconciliation from authenticated, operation-bound local-chain evidence;
- deterministic chain/fault/ambiguity tests.

## Out of scope

- public RPC, testnet, mainnet or real assets;
- production custody or production identity;
- arbitrary raw signing or unrestricted message signing;
- Safe, MetaMask, Turnkey or other external provider adapters;
- Phase-4 MCP/CLI/dashboard interfaces;
- claiming completion of Phase-3 integrated pre-sign/revocation/pause/broadcast-unknown control proof.

## Security invariants

1. The transaction that is signed must be the transaction that was independently verified, simulated and authorized.
2. Envelope v2 must bind every unsigned EIP-1559 field used by the signer: chain, sender, target, value, calldata, resolved nonce, type, gas limit, max priority fee, max fee, and `accessList: []`, plus the accepted simulation block number/hash identity.
3. No caller may substitute recipient, amount, chain, contract, calldata, nonce, transaction type, gas/fee fields, access list, or other executable field after envelope finalization.
4. Envelope v1 remains frozen for Phase-1 evidence; envelope v2 uses schema version `2.0` and a distinct v2 hash-preimage version rather than redefining v1.
5. The signer secret must not cross the local adapter boundary or appear in logs/errors/API results. The local reference signer accepts IDs only and loads canonical authority itself; this is not a universal DB-coupling requirement for future adapters.
6. Unknown or unsupported calldata/capability/enforcement/transaction-family semantics fail closed.
7. Token-budget accounting and native gas fees remain separate assets/authorities.
8. Simulation freshness is tied to canonicality, bounded age, and changed execution assumptions; an unrelated newer head alone does not invalidate a still-canonical simulation inside the configured window.
9. The expected transaction hash and broadcast-attempt identity are durable before send. Broadcast ambiguity must never be interpreted as definitive failure solely because a response was lost, timed out, or transport failed.
10. RPC transaction/block/receipt/log data is untrusted evidence. ADR-0014 authenticated RECONCILER evidence is required before the existing exactly-once ledger recovery path mutates financial state.
11. Reconciliation is idempotent and must not double-finalize spend; chain evidence for one operation cannot reconcile another operation.
12. All local RPC endpoints remain loopback-only and chain-pinned to Anvil `31337` / `0x7a69`.
13. Existing S0/S1 invariants and tests remain mandatory throughout this workstream.

## Packet order

1. P2-01 deterministic mock-token/local-chain fixture
2. P2-02 construction + independent verification + envelope v2
3. P2-03 simulation + fee enforcement
4. P2-04 restricted local signer/adapter boundary
5. P2-05 broadcast + confirmation + reconciliation
6. P2-06 fault/ambiguity evidence + S2 closeout

Security dependencies must not be parallelized into incompatible transaction/envelope/adapter state models. P2-02 through P2-05 remain sequential because they share the exact executable-envelope and evidence model.

## Researched implementation boundary

The implementation-ready contract is in `docs/plans/PHASE-2.md`. It reuses the Phase-1 canonical authorization guard, four-scope control fences, authenticated ADAPTER/RECONCILER credentials, broadcast evidence, recovery leases and exactly-once ledger resolution. It does not create another authorization, budget, approval, envelope-lifecycle or reconciliation source of truth.

ADR-0015 is **ACCEPTED**. It resolves the previous exact-signing blocker by requiring additive envelope v2 semantics, `accessList: []`, bounded canonical simulation freshness, local-Anvil IDs-only signer isolation without universal provider DB coupling, persist-before-send expected-hash evidence, and ADR-0014-authenticated reconciliation of untrusted chain evidence.

P2-01 is complete locally with pinned contract tests and a checkout-bound fixture/chain gate. P2-02 is integrated at coordinator head `733b32f` from stable head `343de49`. P2-03 now provides strict executable/evidence schemas, canonical loopback simulation, exact EIP-1559 resolution, native fee enforcement, evidence hashing and bounded freshness. Local checks pass; the default full chain gate retains an inherited 5-second fixture reset-test timeout, while the fixture test passes 9/9 with a 15-second diagnostic timeout and the focused P2-03 chain test passes 1/1. Protected current-head evidence is not claimed. P2-04 may consume the resulting exact candidate and simulation evidence.

## Exit evidence

WS-004 is complete only when protected current-head evidence proves the entire local fake-ERC-20 journey and the required failure/ambiguity cases in `docs/plans/PHASE-2.md`.

Until then Gate S2 remains **NOT PASSED**.
