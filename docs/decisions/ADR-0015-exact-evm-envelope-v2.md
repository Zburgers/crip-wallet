# ADR-0015 - Exact EVM Envelope V2 and Local Execution Evidence

**Status:** Accepted — 2026-08-21 by product owner

**Date:** 2026-08-21

## Context

The accepted execution-envelope v1 binds a nonce strategy but not the resolved nonce, stores one simulation block reference rather than both number and hash, and binds `maxFeePerGas` but not the EIP-1559 transaction type, priority fee, or access list. Phase 1 did not sign transactions, so those omissions did not weaken S1. Phase 2 must sign exact EVM bytes; allowing the signer or adapter to resolve executable fields after authorization would contradict the Product Spec's intent/execution equality and ADR-0003's immutable-envelope rule.

Construction and verification also need practical independence. Using one ABI helper to encode and decode its own output would provide weak assurance.

The local Anvil adapter is a reference adapter. Its local process/DB integration must not become a requirement that every future provider adapter directly access Crip's PostgreSQL state.

## Decision

1. Add an additive **execution-envelope v2** for the Phase-2 EIP-1559 transfer. Envelope v2 uses `schemaVersion: "2.0"` and envelope hash-preimage version `v2`. Envelope v1 keeps `schemaVersion: "1.0"`, hash-preimage version `v1`, its exact parsing semantics, persisted records, and golden hash vectors. Implementations must dispatch validation/hashing by envelope version rather than redefining v1 or changing the shared Phase-1 version literal.
2. Bind every unsigned type-2 transaction field that can affect the signed transaction: existing chain/from/to/value/calldata/gas constraints plus `transactionType: "eip1559"`, resolved `nonce`, `maxPriorityFeePerGas`, and `accessList: []`. The existing `maxFeePerGas` remains bound. The Phase-2 signer receives no discretion to choose or default any executable transaction field after authorization.
3. Phase 2 supports only canonical EIP-1559 type-2 transfers with an empty access list. Any non-empty access list, legacy transaction, blob transaction, authorization-list transaction, or other transaction-family field is unsupported and fails closed.
4. Bind simulation to both `simulationBlockNumber` and `simulationBlockHash` for local chain `31337`. The simulation block must remain canonical. A newer head block alone does **not** invalidate an otherwise canonical simulation inside the configured freshness window. Re-simulation is mandatory when the simulation block becomes non-canonical or too old, the resolved nonce changes, required token/native balances no longer satisfy the transaction assumptions, fee conditions exceed the authorized ceiling, an executable envelope field changes, the local fixture/chain identity changes, or another relevant execution precondition used by simulation changes. Expiry, pause, revocation, policy, approval, and control-fence failures still fail closed at pre-sign revalidation and require fresh authorization as governed by ADR-0003/0005; they do not create a signing bypass.
5. Construct ERC-20 calldata with `viem.encodeFunctionData`. Independently verify it with a narrow parser that imports no ABI encoder/decoder and accepts only canonical 68-byte `transfer(address,uint256)` calldata with selector `0xa9059cbb`. Unknown selectors, malformed/non-canonical padding, trailing bytes, opaque calldata, or any intent/transaction mismatch fail closed.
6. Use `viem` only inside EVM pipeline/adapter modules for typed RPC, EIP-1559 serialization/signing, and transaction/receipt access. It owns no intent normalization, policy decision, authorization, independent calldata verification, budget decision, or reconciliation decision.
7. The disposable local Anvil signer runs in a process boundary separate from agent-facing interfaces and exposes one IDs-only local operation: sign the current DB-loaded authorized transfer identified by operation/authorization references. It accepts no caller-supplied transaction fields and exposes no arbitrary raw-transaction, message, digest, `personal_sign`, or typed-data signing method. This IDs-only DB-loaded mechanism is the **local-Anvil reference adapter design**, not a requirement that future provider adapters directly access Crip's database; future adapters must preserve the same provider-neutral authorization boundary through their own reviewed transport/capability design.
8. Immediately before signing, the local adapter reloads the immutable current envelope and canonical authorization evidence and rechecks chain/fixture identity, current control fences, expiry, authorization/approval validity, nonce, simulation freshness, required balances, and fee ceiling. Any stale or changed bound field supersedes the envelope where applicable and prevents signing until the governing revalidation path completes.
9. After signing, derive the expected transaction hash from the final signed bytes **before broadcast**. Durably bind the expected hash and a broadcast-attempt identity to the operation, reservation, envelope, authorization, and signed evidence before calling `eth_sendRawTransaction`. Raw signed bytes remain signer-local and are not persisted in control-plane audit/fixture output.
10. RPC return values, transactions, blocks, receipts, and ERC-20 logs are untrusted evidence inputs. A matching RPC-returned hash may advance the broadcast lifecycle, but a timeout, transport exception, response loss, or missing response never proves non-execution and must not release protected funds. Hash mismatch or conflicting evidence fails closed as conflict/dispute.
11. Use one included block as the local-Anvil confirmation rule for the deterministic S2 proof; this is **not** a production-finality claim. Before reconciliation, independently match the expected transaction hash, chain/fixture identity, canonical block, transaction fields, receipt status, and exactly the expected ERC-20 `Transfer` evidence to the operation, reservation, and envelope.
12. Preserve ADR-0014 as the execution-evidence authentication authority. Chain evidence itself is not a credential. The reconciler verifies and normalizes the untrusted chain evidence, binds the conclusion to the operation/reservation/transaction, authenticates the action using the existing active RECONCILER component credential/domain-separated payload, and only then invokes the existing lease-fenced, exactly-once ledger recovery/reconciliation path.
13. Native gas remains separate from ERC-20 delegated spend. For the Phase-2 type-2 transaction, the authorized maximum native fee remains `gasLimit * maxFeePerGas`, bounded by the lower of intent and active-policy ceilings before envelope finalization and again immediately before signing. Actual native fees are evidence only and never reduce the ERC-20 budget tuple.

## Consequences

- A forward migration must extend envelope validation without rewriting migrations `0001`-`0021` or changing the meaning/checksum of any Phase-1 migration.
- Existing envelope v1 records remain valid for Phase-1 evidence but are not signable by the Phase-2 adapter.
- Envelope v2 has a distinct schema/hash version, preventing v1/v2 hash-domain ambiguity.
- Any bound nonce, transaction type, priority fee, fee ceiling, access list, simulation identity, or other executable field change supersedes the v2 envelope and invalidates authorization as governed by ADR-0003.
- A simple new head block does not create a re-simulation loop; simulation invalidation is tied to canonicality, bounded freshness, and changed execution assumptions.
- `viem` becomes a locked runtime dependency only of EVM-specific pipeline/adapter packages once P2-02 opens.
- The narrow parser supports one ERC-20 transfer and intentionally rejects all other calldata.
- Persist-before-send expected-hash evidence makes response-loss recovery possible without treating transport failure as proof of non-execution.
- The local signer's DB-loaded IDs-only API does not make direct PostgreSQL access part of the universal provider-adapter contract.
- The design proves a local fake-money boundary only and makes no production custody, Byzantine-RPC independence, public-network, or finality claim.

## Alternatives Rejected

- Reuse v1 and resolve nonce/fees inside the signer: violates exact immutable authorization.
- Change the meaning of schema/hash version v1 in place: breaks frozen Phase-1 compatibility and weakens auditability.
- Put missing values only inside a simulation hash: prevents direct DB/schema validation and review.
- Let library defaults choose access-list or transaction-family fields after authorization: violates exact signing authority.
- Use `viem` to decode its own encoded calldata: insufficiently independent.
- Add `ethers` solely as a decoder: unnecessary supply-chain/runtime surface.
- Hand-roll EIP-1559 serialization or secp256k1 signing: unacceptable correctness and cryptographic risk.
- Support legacy and EIP-1559 together: unnecessary state and test expansion for the MVP proof.
- Treat a receipt/RPC response as authenticated authority by itself: contradicts the existing ADR-0014 authenticated-component and reconciliation boundary.

## Verification Requirements

- Schema and DB tests preserve every v1 vector and prove v2 parsing/hash determinism under a distinct v2 hash-preimage version.
- Mutation tests cover every v2-bound transaction field, including resolved nonce, type, priority fee, max fee, gas limit, calldata, value, chain, and `accessList: []`.
- Simulation tests prove canonical block identity, bounded freshness, and that an unrelated newer head alone does not invalidate a still-valid simulation.
- Signer tests prove the local API is IDs-only, loads canonical DB authority, cannot accept caller transaction fields, and exposes no general signing method or secret/raw-byte output.
- Broadcast fault tests prove expected transaction hash/attempt persistence occurs before send and transport/response loss becomes UNKNOWN/DISPUTED rather than definitive failure.
- Reconciliation tests prove untrusted transaction/receipt/log evidence must match the operation/reservation/envelope and must pass ADR-0014 authenticated reconciler evidence before exactly-once economic resolution.
- Threat model and Phase-2 plan retain fail-closed unknown-calldata, stale-state, wrong-chain, fee, signer, ambiguity, local-reset, and cross-operation reconciliation controls.

## Related

- `docs/PRODUCT_SPEC.md` sections 16, 18.7, 19, 20, 21, and 23.
- ADR-0003, ADR-0005, ADR-0006, ADR-0009, ADR-0011, ADR-0014.
- `docs/plans/PHASE-2.md` and `docs/workstreams/WS-004-transaction-pipeline.md`.
- Threats T-031 through T-035 and risks R-022 through R-026.
