# ADR-0015 - Exact EVM Envelope V2 and Local Execution Evidence

**Status:** Proposed - product-owner acceptance required before P2-02

**Date:** 2026-08-21

## Context

The accepted execution-envelope v1 binds a nonce strategy but not the resolved nonce, stores one simulation block reference rather than both number and hash, and binds `maxFeePerGas` but not the EIP-1559 transaction type or priority fee. Phase 1 did not sign transactions, so those omissions did not weaken S1. Phase 2 must sign exact EVM bytes; allowing the signer to resolve these fields after authorization would contradict the Product Spec's intent/execution equality and ADR-0003's immutable-envelope rule.

Construction and verification also need practical independence. Using one ABI helper to encode and decode its own output would provide weak assurance.

## Proposed Decision

1. Add an additive execution-envelope schema/hash version for the Phase-2 EIP-1559 transfer. Preserve all v1 vectors and records.
2. Bind `transactionType: "eip1559"`, resolved `nonce`, `maxPriorityFeePerGas`, `simulationBlockNumber`, and `simulationBlockHash` in addition to existing v1 fields.
3. Permit only type-2 transactions with empty access/authorization/blob fields for this slice. The signer receives no discretion over transaction fields.
4. Construct ERC-20 calldata with `viem.encodeFunctionData`. Independently verify it with a narrow parser that imports no ABI encoder/decoder and accepts only canonical 68-byte `transfer(address,uint256)` calldata with selector `0xa9059cbb`.
5. Use `viem` only inside EVM pipeline/adapter modules for typed RPC, serialization, and local transaction signing. It owns no policy, authorization, or reconciliation decision.
6. Pin simulation to local chain 31337 and a canonical block number/hash. Recheck chain, block, nonce, balances, expiry, fences, and fees immediately before signing; any change requires re-simulation, a new envelope revision, and fresh authorization.
7. Use one local Anvil confirmation, but reconcile only after independently matching the transaction, receipt, canonical block, and ERC-20 Transfer log to the operation, reservation, envelope, and expected precomputed transaction hash.
8. Run the disposable local signer in a separate process with one IDs-only operation: sign the DB-loaded current authorized transfer. No arbitrary raw transaction, message, digest, or typed-data signing method exists.

## Consequences

- A forward migration must extend envelope validation without rewriting migrations 0001-0021.
- Existing envelope v1 records remain valid for Phase-1 evidence but are not signable by the Phase-2 adapter.
- Any nonce, type, priority fee, simulation block, or other bound-field change supersedes the envelope and invalidates authorization.
- `viem` becomes a locked runtime dependency of EVM-specific packages only.
- The narrow parser supports one ERC-20 transfer and intentionally rejects all other calldata.
- The design proves a local fake-money boundary only and makes no production custody, RPC-independence, or finality claim.

## Alternatives Rejected

- Reuse v1 and resolve nonce/fees inside the signer: violates exact immutable authorization.
- Put missing values only inside a simulation hash: prevents direct DB/schema validation and review.
- Use `viem` to decode its own encoded calldata: insufficiently independent.
- Add `ethers` solely as a decoder: unnecessary supply-chain/runtime surface.
- Hand-roll EIP-1559 serialization or secp256k1 signing: unacceptable correctness and cryptographic risk.
- Support legacy and EIP-1559 together: unnecessary state and test expansion for the MVP proof.

## Acceptance Conditions

- Product owner explicitly accepts this ADR before P2-02.
- Schema and DB tests preserve all v1 vectors and prove v2 hash determinism.
- Threat model and Phase-2 plan retain fail-closed unknown-calldata, stale-state, wrong-chain, fee, signer, ambiguity, and reconciliation controls.
