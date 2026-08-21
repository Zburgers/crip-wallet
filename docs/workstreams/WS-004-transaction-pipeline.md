# WS-004 — Transaction Pipeline and Local Anvil Adapter

**Phase:** 2

**Status:** OPEN / PLANNING BOOTSTRAP

**Dependency:** Gate S1 — PASS / ACCEPTED

**Governing plan:** `docs/plans/PHASE-2.md`

## Ownership contract

WS-004 owns the first complete local chain-execution proof for Crip Wallet. Its purpose is to connect the already-proven canonical intent, policy, authorization and budget primitives to one restricted fake-ERC-20 execution path on Anvil.

The workstream must preserve the existing provider-neutral control-plane model. The local Anvil adapter is a reference implementation, not a license to introduce provider-specific authority into core packages.

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
- reservation reconciliation from authoritative local-chain evidence;
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
2. No caller may substitute recipient, amount, chain, contract, calldata, nonce strategy or fee constraints after envelope finalization.
3. The signer secret must not cross the local adapter boundary or appear in logs/errors/API results.
4. Unknown or unsupported calldata/capability/enforcement semantics fail closed.
5. Token-budget accounting and native gas fees remain separate assets/authorities.
6. Broadcast ambiguity must never be interpreted as definitive failure solely because a response was lost.
7. Reconciliation is idempotent and must not double-finalize spend.
8. Chain evidence for one operation cannot reconcile another operation.
9. All local RPC endpoints remain loopback-only and chain-pinned to Anvil `31337` / `0x7a69`.
10. Existing S0/S1 invariants and tests remain mandatory throughout this workstream.

## Initial packet order

1. P2-01 deterministic mock-token/local-chain fixture
2. P2-02 construction + independent verification
3. P2-03 simulation + fee enforcement
4. P2-04 restricted local signer/adapter boundary
5. P2-05 broadcast + confirmation + reconciliation
6. P2-06 fault/ambiguity evidence + S2 closeout

Packet boundaries may be refined by the implementation agent, but security dependencies must not be parallelized into incompatible transaction/envelope/adapter state models.

## Exit evidence

WS-004 is complete only when protected current-head evidence proves the entire local fake-ERC-20 journey and the required failure/ambiguity cases in `docs/plans/PHASE-2.md`.

Until then Gate S2 remains **NOT PASSED**.
