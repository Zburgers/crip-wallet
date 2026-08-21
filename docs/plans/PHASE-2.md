# Phase 2 - Local EVM Vertical Slice / Gate S2 Implementation Plan

> **For implementation agents:** REQUIRED SUB-SKILL: use Shipyard's executing-plans workflow to implement this plan packet by packet. Do not begin P2-02 until proposed ADR-0015 is accepted.

**Goal:** prove one deterministic fake ERC-20 transfer through `construct -> independently decode/verify -> simulate -> authorize -> locally sign -> broadcast -> confirm -> reconcile` on clean local Anvil without weakening S0/S1.

**Architecture:** Phase 2 extends the existing canonical intent, policy, reservation, envelope, approval/control, authenticated-component, recovery, and audit path. A provider-neutral pipeline creates a transaction candidate; a deliberately separate strict decoder verifies its bytes; simulation pins chain state and fees; the existing authorization path finalizes authority; and a restricted local signer process signs only the immutable authorized transaction. Broadcast and reconciliation treat transport failure as uncertainty and consume operation-bound chain evidence exactly once.

**Tech stack:** strict TypeScript/Node.js workspaces, PostgreSQL 17, Vitest/fast-check, Foundry/Anvil/Forge, Solidity, `viem`, existing `@noble/hashes`, Zod, and the existing Ed25519 component-authentication boundary.

**Status:** implementation-ready for P2-01; P2-02 and later are blocked on acceptance of proposed ADR-0015. Gate S2 is **OPEN / NOT PASSED**.

---

## 1. Baseline

- Planning branch: `phase-2/ws-004-local-erc20`.
- Planning start: `efd0142d8beb5795830f2a123fdf104afcfcc004`.
- Accepted `origin/main` baseline and merge base: `f733a41ed16c44ad631f0a5a4b52e8096ab70eed`.
- PR: #5, open draft, Phase 2 / WS-004 bootstrap.
- Accepted gates: S0 PASS; S1 PASS / ACCEPTED; S2 NOT PASSED.
- Existing packages to consume: `packages/schemas`, `packages/policy-engine`, `packages/budget-ledger`, `packages/approvals`, `packages/audit`, and `packages/trust-boundary`.
- Existing migrations: forward-only `0001` through corrective `0021`; do not edit them.
- Existing Phase-1 handoff: an operation and reservation in `AUTHORIZED`, one immutable `authorization_evidence` row, one current envelope revision, no `authorization_invalidations`, and current ACTIVE system/owner/agent/policy fence snapshots.
- Existing execution evidence: `reservation_broadcast_evidence`, `trusted_component_credentials`, `operation_recovery_leases`, and `recovery_attempts` already provide authenticated adapter/reconciler evidence, ambiguity-safe recovery, and exactly-once economic transitions.
- Inherited invariant: `allocated = available + reserved + finalized_spend` in one ERC-20 atomic unit. Native fees never enter this tuple.
- Inherited safety: strict schemas; deterministic/domain-separated hashes; immutable envelopes and decisions; serializable ledger changes; one authorization core; local-only chain `eip155:31337`; no raw/message/typed-data signing surface.

### Actual Phase-1 authorization path

| Stage | Input/output | Persistence and authority |
| --- | --- | --- |
| Intent | `canonicalIntentSchema` -> typed `asset.transfer`; SHA-256 domain-separated idempotency payload hash | immutable `intents`; agent/wallet/policy identity is DB-bound |
| Policy | `evaluatePolicy(policy, intent, context)` -> deterministic decision and Keccak decision hash | immutable `policy_decisions`; chain/asset/recipient/action/token budget/native-fee rules already exist |
| Reservation | `reserveBudget` -> `HELD` under SERIALIZABLE transaction | `budget_accounts`, `budget_reservations`, `idempotency_records`; SYSTEM->OWNER->AGENT->POLICY lock prefix |
| Envelope | canonical candidate plus decision/reservation -> hash-bound revision | immutable `execution_envelopes`; DB recomputes schema/hash/bindings/lineage |
| Approval/control | `createApprovalRequest`, authenticated owner decision, or autonomous authorization owner | approval rows bind envelope/policy/reservation/fence snapshot; no caller-supplied identity authority |
| Authorization | `consumeApproval` -> operation/reservation `AUTHORIZED` and immutable evidence | `authorization_evidence`; canonical DB guard rejects stale/superseded/invalidated/fence-mismatched authority |
| Recovery | authenticated adapter/reconciler evidence and lease-fenced resolution | CONFIRMED finalizes; definitive pre-broadcast FAILED releases; AMBIGUOUS/CONFLICT disputes and retains funds |

**Exact Phase-2 handoff:** the signing consumer accepts only `{ operationId, authorizationId }`, loads the current envelope and reservation from PostgreSQL, and revalidates canonical authorization and all four control fences immediately before signing. It never accepts caller-provided transaction fields or raw bytes.

### ADR dependency map

```text
ADR-0001 provider-neutral/local-only -> ADR-0009 adapter/signer -> ADR-0004 enforcement grades
ADR-0002 atomic reservation -> ADR-0006 fee separation -> ADR-0003 envelope lifecycle/hash
ADR-0003 immutable envelope -> ADR-0005 pre-sign controls -> ADR-0008 approval binding
ADR-0010 transactional audit -> ADR-0014 authenticated evidence -> ADR-0011 recovery leases
ADR-0001 single core -> ADR-0012 minimal interfaces
ADR-0007 TypeScript/PostgreSQL/Vitest constrains every packet
proposed ADR-0015 adds the minimum exact-EVM envelope-v2 fields required by ADR-0003/product spec
```

## 2. Architecture Summary

```text
UNTRUSTED AGENT / TEST DRIVER
  canonical intent + idempotency key only
              |
              v
+---------------- CONTROL-PLANE TCB ----------------+
| schema -> policy precheck -> candidate constructor |
|                         |                          |
| viem encodeFunctionData |                          |
|                         v                          |
|                strict independent decoder         |
|             (manual selector/word parser)          |
|                         |                          |
|                         v                          |
| local RPC simulation @ block hash + fee checks    |
|                         |                          |
| final policy -> atomic reservation -> envelope v2 |
| -> existing approval/autonomous authorization     |
+-------------------------+--------------------------+
                          | operationId + authorizationId
                          | authenticated local IPC
                          v
+---------------- LOCAL SIGNER/ADAPTER PROCESS ------+
| reload immutable envelope; verify DB authority,    |
| fence, expiry, chain, nonce, fee ceiling; construct|
| fixed EIP-1559 tx from envelope; sign locally;     |
| retain raw bytes only in process memory            |
+-------------------------+--------------------------+
                          | eth_sendRawTransaction
                          v
+---------------- UNTRUSTED RPC BOUNDARY ------------+
| loopback URL allowlist -> Anvil 31337 -> fake ERC20|
+-------------------------+--------------------------+
                          | tx + receipt + block evidence
                          v
+---------------- RECONCILER TCB --------------------+
| independently load transaction and receipt; verify |
| operation/reservation/hash/from/to/input/value/fee;|
| authenticated evidence + lease-fenced resolution; |
| finalize once, release only on proven pre-broadcast|
| failure, otherwise retain/dispute                  |
+----------------------------------------------------+
```

The RPC is evidence input, not authorization. The constructor is not its own verifier. The signer is not a policy engine. The adapter SDK does not own authorization. The reconciler cannot move another operation's reservation.

## 3. Key Design Decisions

### D1 - Add envelope schema v2 before EVM signing

- Alternatives: reuse v1 unchanged; hide values in hashes; add explicit fields.
- Selected: proposed ADR-0015 adds `transactionType: "eip1559"`, resolved `nonce`, `maxPriorityFeePerGas`, and simulation `{blockNumber, blockHash}` while preserving every v1 field and hash-domain rules with a new schema/hash version.
- Rationale: v1 binds only `nonceStrategy`, one ambiguous block reference, and `maxFeePerGas`; it cannot prove exact signed bytes or stale simulation.
- Security: additive v2 eliminates signer discretion over nonce/type/priority fee and permits exact state freshness checks.
- ADR: required; proposed ADR-0015 must be accepted before P2-02.

### D2 - Use one dependency for EVM mechanics, not authority

- Alternatives: `ethers`, raw JSON-RPC plus hand-rolled signing/RLP/ABI, or `viem`.
- Selected: `viem` in EVM-specific packages/adapters for typed RPC, ABI construction, EIP-1559 serialization/signing, and receipt access.
- Rationale: current Context7 material exposes `encodeFunctionData`, block-hash `call`, `estimateGas`, `estimateFeesPerGas`, `account.signTransaction`, `sendRawTransaction`, `getTransaction`, `getTransactionReceipt`, and `waitForTransactionReceipt`; it is modular and tree-shakeable.
- Security: `viem` must not evaluate policy, authorize, choose unconstrained fees/nonces, expose accounts, or verify its own constructed calldata.
- ADR: dependency and boundary are covered by ADR-0009; record in accepted ADR-0015.

### D3 - Independent verification uses a narrow manual ERC-20 decoder

- Alternatives: `viem` encode plus `viem` decode; a second Ethereum library; a 68-byte strict parser.
- Selected: constructor uses `viem.encodeFunctionData`; verifier imports no ABI encoder/decoder and accepts exactly 68 bytes: selector `0xa9059cbb`, one zero-left-padded address word, and one uint256 word.
- Rationale: meaningful implementation independence without a second runtime dependency or hand-rolled general ABI support.
- Security: non-canonical padding, trailing bytes, unknown selectors, zero/overflow/format errors, extra calls, or any field mismatch fail closed.
- ADR: captured by ADR-0015 because it defines the MVP assurance boundary.

### D4 - Simulate exact call at a canonical block and recheck at sign time

- Alternatives: `simulateContract` with helper-generated request; raw `eth_call` at `latest`; `publicClient.call` with exact candidate at block hash.
- Selected: fetch latest block number/hash, call exact `{from,to,data,value,gas,maxFeePerGas,maxPriorityFeePerGas,nonce}` with `blockHash` and `requireCanonical`, estimate gas, query token/native balances at the same block, and hash normalized evidence.
- Freshness rule: before signing, chain ID, current block ancestry/hash, sender pending nonce, native balance, token balance, and fee constraints are rechecked. Any nonce change, missing/noncanonical block, token balance below amount, fee ceiling breach, base fee above max fee, or configured maximum age exceeded produces `REVALIDATION_REQUIRED`; re-simulation creates a new envelope revision and fresh authorization.
- ADR: part of ADR-0015.

### D5 - EIP-1559 only for the Phase-2 transfer

- Alternatives: legacy gas price; support both formats; EIP-1559 only.
- Selected: type-2 EIP-1559 only. `maximumNetworkFeeAtomic = gasLimit * maxFeePerGas`; priority fee must be nonnegative and <= max fee. Blob/access-list/7702 fields fail closed.
- Security: one transaction format minimizes ambiguity; actual native fee is evidence only and never changes token budget.
- ADR: ADR-0006 permits EIP-1559; v2 field binding is ADR-0015.

### D6 - Reserve token value only; persist fee constraints/evidence separately

- Alternatives: reserve gas from token budget; add native rolling budget; enforce per-transaction ceiling only.
- Selected: existing ERC-20 reservation remains amount-only. Envelope v2 holds authorized native fee ceiling. New execution tables persist simulation, signed/broadcast state, transaction/receipt evidence, and actual native fee. No native budget account is created in Phase 2.
- Security: integer decimal strings/numeric(78,0), checked multiplication, and lower-of-intent/policy ceiling at envelope and pre-sign.
- ADR: no new accounting ADR; follows ADR-0006.

### D7 - Separate signer process with a capability-shaped IPC API

- Alternatives: in-process private key; unrestricted wallet client RPC; local child process/Unix socket.
- Selected: `adapters/local-anvil` executable loads one disposable private key from ignored mode-0600 Anvil state or a dedicated inherited file descriptor, verifies expected address, and exposes only `signAuthorizedTransfer({operationId, authorizationId})`. No raw transaction/message/digest/typed-data endpoint exists.
- Security: no key in arguments/env/logs/results; raw signed bytes remain signer-local and are handed directly to broadcaster; core receives only signed transaction hash/metadata. Process crash after signing is signed-unbroadcast ambiguity and disputes until non-execution is proven.
- ADR: conforms to ADR-0009; exact local isolation is recorded in ADR-0015.

### D8 - Derive transaction hash before broadcast and model attempts durably

- Alternatives: trust RPC-returned hash; persist only after response; precompute Keccak from signed bytes and persist before send.
- Selected: signer derives the transaction hash from serialized signed bytes; adapter transactionally records `SIGNED` plus expected hash before broadcast, then records each attempt before sending. RPC-returned hash must match expected hash.
- Security: response loss is recoverable by hash and nonce. An exception never proves non-execution.
- ADR: lifecycle application of ADR-0011/0014; no new ADR beyond ADR-0015.

### D9 - One Anvil confirmation, followed by full transaction/receipt matching

- Alternatives: receipt existence only; multiple local confirmations; one deterministic local confirmation.
- Selected: one included block is sufficient for deterministic local Anvil S2, but the reconciler verifies chain ID, receipt hash/status/block, transaction hash/from/to/input/value/nonce/type/gas/fee fields, canonical block hash, and exactly one matching ERC-20 `Transfer` log. Wrong or incomplete evidence disputes.
- Security: a receipt alone cannot reconcile. Local-chain reset is detected with a persisted fixture fingerprint/genesis hash and deployment code hash.
- ADR: confirmation policy is local-only and should be included in ADR-0015.

### D10 - Reuse Phase-1 authenticated recovery

- Alternatives: new transaction worker tables; in-memory retries; adapt existing evidence and leases.
- Selected: add chain-specific immutable evidence, then feed authenticated adapter/reconciler results through existing component credentials, recovery leases, attempts, and ledger transitions.
- Security: CONFIRMED finalizes exactly once; only proven no-send/pre-acceptance failure releases; unknown/conflict disputes and retains reservation.
- ADR: ADR-0014 already defines the authority; no parallel mechanism.

## 4. Dependency and Tooling Decisions

### Selected

| Dependency/tool | Responsibility | Must not own | Production/runtime effect |
| --- | --- | --- | --- |
| `viem` exact version locked by npm | EVM types, constructor ABI encoding, RPC transport, type-2 serialization/signing, transaction/receipt access | intent normalization, policy, independent decode, authorization, reconciliation decision | production dependency only of EVM pipeline/adapter packages; transitive audit required |
| Existing Foundry image pinned by digest | Forge build/test and local Anvil | production RPC/provider or key custody | no new host install; CI uses pinned container |
| Minimal local Solidity ERC-20 | deterministic fake asset and deliberate revert seam | real asset semantics, upgradeability, mint API exposed to control plane | test/local artifact only |
| Existing `@noble/hashes` | envelope/evidence hashes and pre-broadcast tx-hash comparison where appropriate | transaction signing | no new dependency |

### Rejected

- `ethers`: capable, but duplicative if `viem` is selected and its broad object/provider surface does not improve the narrow provider-neutral boundary.
- Two Ethereum libraries for construction/verification: larger supply-chain surface; independence is better achieved with a tiny strict parser.
- Raw `fetch` plus hand-written secp256k1/RLP/EIP-1559: unacceptable cryptographic/serialization risk.
- Hardhat: unnecessary second framework; Foundry is already pinned in Compose and expected by repository ignore rules.
- OpenZeppelin runtime dependency: unnecessary for a tiny local fake token. Implement the minimal standard ERC-20 fixture in-repo with tests; no approvals/permits/admin/proxy surface.
- `solc` npm package: duplicates compiler management; use the pinned Foundry image and pin `solc_version` in `foundry.toml`.

### Context7 evidence consulted

- `/wevm/viem`: `encodeFunctionData`; strict ABI APIs; `call` with EIP-1898 block hash and `requireCanonical`; gas/fee estimation; EIP-1559 serialize/sign; raw send; receipt polling/replacement; transaction and raw-transaction lookup.
- `/foundry-rs/foundry`: Anvil/Forge usage, pinned image verification, compiler configuration, contract build/test/deploy mechanics.
- `/openzeppelin/openzeppelin-contracts`: standard ERC-20 fixed-supply `_mint` pattern and transfer behavior; used as standards reference, not selected as dependency.
- `/ethers-io/ethers.js`: provider, ABI, wallet, fee, and raw RPC capabilities considered as the principal rejected TypeScript alternative.

The Context7 MCP tools were unavailable in the planning session; research used Context7's project `llms.txt` endpoint for these exact library IDs. P2-01 must record exact selected versions after `npm view`/Foundry image inspection and rerun dependency audit before lockfile change.

## 5. Data Model Impact

### Reused unchanged

`intents`, `operations`, `policy_decisions`, `budget_accounts`, `budget_reservations`, `idempotency_records`, `execution_envelopes`, `approval_requests`, `approval_decisions`, `authorization_evidence`, `authorization_invalidations`, `control_fences`, `trusted_component_credentials`, `reservation_broadcast_evidence`, `operation_recovery_leases`, `recovery_attempts`, and `audit_events`.

The existing lifecycle already contains CONSTRUCTED, DECODED, VERIFIED, SIMULATED, POLICY_FINALIZED, BUDGET_RESERVED, ENVELOPE_FINALIZED, AUTHORIZED, SIGNING, SIGNED, BROADCAST, PENDING_CONFIRMATION, CONFIRMED, RECONCILED, failure, DISPUTED, and REVALIDATION_REQUIRED. **Do not add lifecycle enum values.** Map `broadcast-attempted` to an attempt row while operation remains SIGNED; known acceptance moves to BROADCAST; receipt wait moves to PENDING_CONFIRMATION; stale simulation moves to REVALIDATION_REQUIRED; ambiguous execution moves to DISPUTED.

### Proposed schemas

- `executionEnvelopeV2Schema`: additive exact EIP-1559 and block-pinning fields from D1; no mutation of v1.
- `transactionCandidateSchema`: mutable pre-envelope object containing exact transaction and provenance.
- `decodedTransferSchema` and `transactionVerificationResultSchema`: fail-closed typed verifier output/mismatch codes.
- `simulationEvidenceSchema`: exact call, block number/hash, chain, nonce, balances, gas estimate/limit, fee quote/ceiling, result/revert, expected deltas, simulator version, evidence hash.
- `signAuthorizedTransferRequestSchema`: only operation/authorization IDs and adapter request ID.
- `broadcastAttemptSchema`, `chainTransactionEvidenceSchema`, and `chainReceiptEvidenceSchema`: normalized immutable chain evidence without raw signed bytes.

### Proposed forward migration `0022_ws004_evm_execution_evidence.sql`

- Extend the DB envelope-validation function to accept schema v2 while retaining v1 validation and its frozen vectors.
- Extend audit-event CHECK values for construction, verification, simulation, signing, broadcast attempt/known, confirmation, receipt mismatch, and reconciliation events.
- Create `transaction_candidates` only if candidate durability is required before reservation; preferred design persists normalized simulation evidence and finalized transaction fields, not unauthorizable drafts.
- Create `transaction_simulations` keyed by `(operation_id, envelope_revision)` with chain ID, block number/hash, sender nonce, token/native balances, gas/fee fields, normalized outcome, evidence hash, and immutable trigger.
- Create `signed_transactions` keyed by operation/reservation/envelope/authorization with expected transaction hash, signer component credential identity, signed-at time, and no raw bytes/private material.
- Create `broadcast_attempts` keyed by `attempt_id`, bound to signed transaction and expected hash, with `STARTED/ACCEPTED/REJECTED/UNKNOWN`; append-only except one guarded terminal transition.
- Create `chain_transaction_evidence` and `chain_receipt_evidence`, each operation/reservation/expected-hash bound, with canonical block identity and immutable normalized fields.
- Add unique constraints that prevent one transaction hash from binding multiple operations/reservations and prevent more than one economic reconciliation effect.
- Add triggers that require canonical current authorization before SIGNING/SIGNED and matching signed/broadcast/receipt evidence before later reservation/lifecycle transitions.

Migration is required. It is additive/forward-only and must not alter the meaning or checksums of migrations 0001-0021.

## 6. API and Interface Contracts

```ts
type ConstructTransfer = (
  intent: CanonicalTransferIntent,
  trusted: { walletAddress: Address; tokenAddress: Address; chainId: "eip155:31337" },
) => TransactionCandidate;

type DecodeTransferIndependent = (calldata: Hex) =>
  | { ok: true; selector: "0xa9059cbb"; recipient: Address; amountAtomic: string }
  | { ok: false; code: DecodeFailureCode };

type VerifyTransfer = (
  intent: CanonicalTransferIntent,
  candidate: TransactionCandidate,
  decoded: DecodedTransfer,
  trusted: TrustedExecutionContext,
) => VerificationResult;

type SimulateTransfer = (
  verified: VerifiedTransactionCandidate,
  rpc: LocalReadRpc,
) => Promise<SimulationEvidence>;

type FinalizeEnvelopeV2 = (
  verified: VerifiedTransactionCandidate,
  simulation: SuccessfulFreshSimulation,
  decision: PolicyDecision,
  reservation: ReservationSnapshot,
) => ExecutionEnvelopeV2;

interface WalletAdapter {
  manifest(): AdapterCapabilityManifest;
  signAuthorizedTransfer(request: { operationId: string; authorizationId: string }): Promise<{ transactionHash: Hash }>;
  recoverTransaction(request: { operationId: string; transactionHash: Hash; nonce: string }): Promise<NormalizedChainEvidence>;
}

type ReconcileTransfer = (
  claim: AuthenticatedReconcilerClaim,
  evidence: VerifiedChainEvidence,
) => Promise<RecoveryResolution>;
```

Trust direction:

- Intent fields are untrusted until schema/policy validation.
- Trusted wallet/token identity comes from DB/local fixture, never symbol/decimal hints.
- Constructor output is untrusted input to the independent verifier.
- RPC simulation and receipts are untrusted evidence that must be cross-checked.
- Adapter manifest is a claim checked against required grades.
- Signer trusts only DB-loaded immutable envelope plus current authorization/fences, never caller transaction data.
- Reconciler trusts neither adapter labels nor a receipt alone; Ed25519 component authentication and operation-bound chain matching are mandatory.

## 7. Phase-2 State Transition Map

```text
POLICY_PRECHECKED
  -> CONSTRUCTED -> DECODED -> VERIFIED
  -> SIMULATED
       | failure/revert/balance/fee -> SIMULATION_FAILED (no reservation)
       | state changed             -> REVALIDATION_REQUIRED -> new candidate/simulation
  -> POLICY_FINALIZED -> BUDGET_RESERVED -> ENVELOPE_FINALIZED
  -> AWAITING_APPROVAL -> AUTHORIZED   (review mode)
  -> AUTHORIZED                         (autonomous mode through same evidence guard)
  -> SIGNING
       | definitive pre-sign failure -> SIGNING_FAILED; release only if no signed bytes exist
       | stale fence/nonce/simulation -> REVALIDATION_REQUIRED; retain/revalidate reservation
  -> SIGNED
       | crash/uncertain bytes       -> DISPUTED; prove non-execution before release
       | broadcast attempt row only  -> remains SIGNED
  -> BROADCAST
  -> PENDING_CONFIRMATION
       | receipt absent/response lost -> remain pending or DISPUTED; never release
       | receipt status reverted      -> REVERTED; finalize token spend as zero only from verified evidence,
                                         then release reservation under explicit recovery outcome
       | mismatch/wrong chain/hash    -> DISPUTED
  -> CONFIRMED -> RECONCILED
```

`BROADCAST_FAILED` is only a definitive rejection before RPC acceptance plus proof the expected hash is absent and nonce remains unused. A generic transport exception maps to UNKNOWN, not failure.

## 8. Work Packets

### P2-01 - Deterministic local fake ERC-20 fixture

**Objective:** establish reproducible Solidity build/deploy/reset artifacts on only the existing checkout-bound Anvil.

**Dependencies:** S1 accepted; no ADR-0015 dependency.

**Files:**

- Create: `contracts/foundry.toml`
- Create: `contracts/src/MockERC20.sol`
- Create: `contracts/test/MockERC20.t.sol`
- Create: `contracts/script/DeployMockERC20.s.sol`
- Create: `tooling/phase2-contracts.mjs`
- Create: `tooling/phase2-fixture.mjs`
- Create: `tests/chain/fixture.test.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`, `.gitignore`, `docs/TESTING.md`

<task id="P2-01A" name="Pin contract toolchain and mock token">
  <description>Add a minimal six-decimal fixed-supply fake ERC-20 with standard Transfer behavior and a test-only deterministic revert recipient. Pin Solidity and run Forge only through the existing digest-pinned container.</description>
  <tests-first>Forge tests for metadata, initial supply, successful transfer, insufficient balance, zero-address rejection, and deterministic revert seam.</tests-first>
  <verification><command>npm run contracts:test</command><expected>Forge exits 0 with all MockERC20 tests passing.</expected></verification>
</task>

<task id="P2-01B" name="Deploy checkout-bound fixture">
  <description>Load `.local/runtime.env`, reject every non-loopback/non-31337 context, deploy from the disposable account without exposing its key in argv/logs, verify runtime bytecode hash/metadata/supply, and write mode-0600 `.local/phase2-fixture.json` containing no private key.</description>
  <tests-first>Repository tests for public host, wrong chain, stale checkout, malformed Anvil state, and secret-free fixture output.</tests-first>
  <verification><command>npm run dev:up && npm run fixture:phase2 && npm run test:chain -- fixture.test.ts</command><expected>chain 31337, expected accounts/code hash/6 decimals/supply; exit 0.</expected></verification>
</task>

**Invariants:** fake token only; no approvals/permit/mint-after-deploy/proxy; fixture fingerprint includes chain/genesis/deployment/code hash; generated key material remains ignored and 0600.

**Commit boundaries:** `build: add pinned fake ERC-20 fixture`; `test: prove local fixture safety`.

**Risks:** Foundry `stable` image drift despite digest pin; record exact Forge/Solc versions in fixture evidence. Deployment key handling must use stdin/file descriptor, never argv.

**Non-goals:** transaction pipeline, policy, signing API, public deployment, OpenZeppelin dependency.

### P2-02 - Exact construction, independent verification, and envelope v2

**Objective:** produce and independently verify one exact transfer candidate, then make the accepted envelope-v2 contract available.

**Dependencies:** P2-01 and accepted ADR-0015.

**Files:**

- Create: `packages/transaction-pipeline/package.json`, `tsconfig.json`
- Create: `packages/transaction-pipeline/src/candidate.ts`
- Create: `packages/transaction-pipeline/src/construct-transfer.ts`
- Create: `packages/transaction-pipeline/src/decode-transfer.ts`
- Create: `packages/transaction-pipeline/src/verify-transfer.ts`
- Create: `packages/transaction-pipeline/test/{construct,decode,verify}.test.ts`
- Modify: `packages/schemas/src/envelope.ts`, `packages/schemas/src/index.ts`, envelope hash vectors/tests, root `tsconfig.json`, lockfile

<task id="P2-02A" name="Define candidate and envelope-v2 schemas">
  <description>Add strict candidate/verification schemas and additive envelope v2 with exact type-2 nonce/fees and block number/hash. Preserve v1 vectors.</description>
  <tests-first>Unknown fields, unsafe numbers, mixed-case/noncanonical bytes, missing nonce/priority fee/block identity, and v1 regression vectors.</tests-first>
  <verification><command>npm run test:unit -- --run packages/schemas/test/envelope-hash.test.ts</command><expected>v1 and v2 deterministic vectors pass.</expected></verification>
</task>

<task id="P2-02B" name="Construct transfer candidate">
  <description>Use only trusted wallet/token identity plus canonical intent and `viem.encodeFunctionData`; set chain/from/to/value=0 and no fee/nonce defaults until explicitly supplied by the pipeline.</description>
  <tests-first>Known vector for recipient and amount, ignored symbol/decimal hints, target/chain/from provenance.</tests-first>
  <verification><command>npx vitest run packages/transaction-pipeline/test/construct.test.ts</command><expected>exact calldata vector passes.</expected></verification>
</task>

<task id="P2-02C" name="Implement independent strict decoder">
  <description>Parse lowercase hex manually: exact 68-byte length, selector, 12 zero padding bytes, 20-byte recipient, and uint256 amount. Import no viem ABI decoding helpers.</description>
  <tests-first>Unknown selector, truncation, trailing data, nonzero padding, malformed hex, zero recipient, max uint256, and opaque calldata.</tests-first>
  <verification><command>npx vitest run packages/transaction-pipeline/test/decode.test.ts</command><expected>all malformed/unsupported vectors fail closed.</expected></verification>
</task>

<task id="P2-02D" name="Verify complete candidate binding">
  <description>Compare chain, sender, token target, selector, recipient, amount, exact calldata, value, type, nonce strategy/resolved nonce, gas, fees, operation/intent/policy/reservation provenance. Return typed mismatches; never normalize mismatches into success.</description>
  <tests-first>One mutation per bound field plus compound substitutions and constructor/verifier differential vectors.</tests-first>
  <verification><command>npx vitest run packages/transaction-pipeline/test/verify.test.ts</command><expected>only the exact candidate passes.</expected></verification>
</task>

**Commit boundaries:** one commit per task. **Non-goals:** simulation, signing, generic ABI, arbitrary calls.

### P2-03 - Canonical simulation and native-fee enforcement

**Objective:** simulate exact verified bytes against pinned Anvil state and prove token/gas authority separation.

**Dependencies:** P2-02.

**Files:**

- Create: `packages/simulation/{package.json,tsconfig.json}`
- Create: `packages/simulation/src/{local-rpc,simulate-transfer,fee-check,staleness}.ts`
- Create: `packages/simulation/test/*.test.ts`
- Create: `tests/chain/simulation.test.ts`
- Modify: schemas/audit exports as required

<task id="P2-03A" name="Pin exact simulation context">
  <description>Verify `eth_chainId`, get latest block number/hash, pending sender nonce, token/native balances, and execute exact call with from/to/data/value at block hash with canonical requirement.</description>
  <tests-first>wrong chain, missing block hash, RPC malformed values, contract revert, insufficient token balance.</tests-first>
  <verification><command>npm run test:chain -- simulation.test.ts</command><expected>success and revert evidence are deterministic and block-pinned.</expected></verification>
</task>

<task id="P2-03B" name="Estimate gas and enforce fees">
  <description>Estimate exact call gas, apply one documented bounded gas margin, estimate EIP-1559 fees, enforce priority<=maxFee and gasLimit*maxFee<=min(intent, policy), and verify native balance covers maximum cost with checked bigint arithmetic.</description>
  <tests-first>insufficient native balance, overflow/bad integer, fee ceiling equal/below/above, priority fee violation, base-fee escalation.</tests-first>
  <verification><command>npx vitest run packages/simulation/test/fee-check.test.ts</command><expected>all ceiling vectors pass; token reservation inputs remain unchanged.</expected></verification>
</task>

<task id="P2-03C" name="Normalize evidence and invalidate staleness">
  <description>Hash normalized simulation evidence; require unchanged chain, canonical block, nonce, balances sufficient for transfer/max gas, fees within ceiling, and configured block-age bound before authorization/signing.</description>
  <tests-first>mined intervening tx, nonce consumption, token drain, native drain, local reset, stale block, changed fee quote.</tests-first>
  <verification><command>npm run test:chain -- simulation.test.ts && npx vitest run packages/simulation/test/staleness.test.ts</command><expected>every stale input returns REVALIDATION_REQUIRED.</expected></verification>
</task>

**Non-goals:** external simulator/risk provider, state overrides, token gas budget, simulation-as-authorization.

### P2-04 - Persistence, restricted signer, and adapter boundary

**Objective:** finalize/persist envelope-v2 evidence and sign only current canonical authority in a separate local process.

**Dependencies:** P2-03; state/API stabilization required.

**Files:**

- Create: `migrations/0022_ws004_evm_execution_evidence.sql`
- Create: `packages/adapter-sdk/{package.json,tsconfig.json,src/index.ts,test/manifest.test.ts}`
- Create: `adapters/local-anvil/{package.json,tsconfig.json}`
- Create: `adapters/local-anvil/src/{main,config,authorized-transfer-loader,signer,ipc,redaction}.ts`
- Create: `adapters/local-anvil/test/*.test.ts`
- Create: `tests/db/phase2-execution-evidence.test.ts`
- Create: `tests/chain/signer.test.ts`

<task id="P2-04A" name="Add forward execution-evidence migration">
  <description>Implement the data model in section 5, v2 DB hash validation, transition guards, append-only/unique operation bindings, and audit event types.</description>
  <tests-first>migration checksum/forward application, v1 compatibility, cross-operation evidence, duplicate hashes, mutation/delete, invalid transitions.</tests-first>
  <verification><command>npm run test:db -- phase2-execution-evidence.test.ts</command><expected>all DB binding and immutability guards pass.</expected></verification>
</task>

<task id="P2-04B" name="Define provider-neutral restricted adapter contract">
  <description>Expose truthful manifest plus ID-only sign/recover methods. Reject arbitrary call, typed data, personal sign, raw digest, raw transaction, unsupported chain/capability/grade.</description>
  <tests-first>manifest strictness and compile-time/runtime absence of forbidden methods.</tests-first>
  <verification><command>npx vitest run packages/adapter-sdk/test</command><expected>manifest and forbidden-capability tests pass.</expected></verification>
</task>

<task id="P2-04C" name="Implement isolated signer process">
  <description>Load disposable key without argv/env exposure, derive/verify expected sender, accept IDs only, authenticate component, reload envelope, call immediate `revalidateAuthorization`, recheck chain/simulation/nonce/fees, transition SIGNING, sign exact type-2 transaction, derive/persist hash and SIGNED evidence, zero/release key references on shutdown.</description>
  <tests-first>caller raw fields rejected, wrong key/address/chain, stale fence/approval/nonce/fee, malformed envelope, revoked component, logging/error redaction, crash before and after signed evidence.</tests-first>
  <verification><command>npm run test:chain -- signer.test.ts</command><expected>exact authorized hash is produced; no secret or raw bytes escape.</expected></verification>
</task>

**Invariant:** the adapter cannot manufacture authorization and the control plane cannot request an arbitrary signature.

**Commit boundaries:** migration; SDK; signer process; adversarial signer tests.

**Non-goals:** daemon hardening for production, HSM/MPC/TEE, network socket exposure, owner MetaMask.

### P2-05 - Broadcast, confirmation, and exact reconciliation

**Objective:** safely cross the ambiguous RPC boundary and convert authoritative matching evidence into one economic result.

**Dependencies:** P2-04.

**Files:**

- Create: `adapters/local-anvil/src/{broadcast,confirm,recover}.ts`
- Create: `packages/transaction-pipeline/src/{verify-chain-transaction,verify-receipt}.ts`
- Create: `packages/transaction-pipeline/test/{verify-chain-transaction,verify-receipt}.test.ts`
- Create: `tests/chain/vertical-slice.test.ts`
- Create: `tests/db/phase2-reconciliation.test.ts`
- Modify: `packages/budget-ledger/src/ledger.ts` only to consume stronger evidence through existing canonical guards; do not add an alternate finalizer

<task id="P2-05A" name="Persist-before-send broadcast attempts">
  <description>Record expected hash and STARTED attempt before `eth_sendRawTransaction`; classify matching response ACCEPTED, explicit pre-acceptance rejection REJECTED, and transport/response/hash uncertainty UNKNOWN. Never reconstruct/re-sign.</description>
  <tests-first>matching/mismatching RPC hash, duplicate raw send, nonce-known cases, response loss.</tests-first>
  <verification><command>npx vitest run adapters/local-anvil/test/broadcast.test.ts</command><expected>transport exceptions produce UNKNOWN, not definitive failure.</expected></verification>
</task>

<task id="P2-05B" name="Confirm and independently match chain evidence">
  <description>Poll by expected hash with bounded retry; fetch transaction, raw transaction where supported, receipt, and canonical block; verify every bound field and exactly one Transfer log; one local confirmation.</description>
  <tests-first>wrong hash/from/to/input/value/nonce/type/fee/recipient/amount/block/chain, missing/reverted receipt, duplicate/wrong logs.</tests-first>
  <verification><command>npx vitest run packages/transaction-pipeline/test/verify-{chain-transaction,receipt}.test.ts</command><expected>only exact operation-bound evidence verifies.</expected></verification>
</task>

<task id="P2-05C" name="Reconcile through existing ledger recovery">
  <description>Authenticate reconciler evidence, lease operation, map verified success to CONFIRMED with actual token amount, verified revert to zero-spend failure, ambiguity/mismatch to DISPUTED, and call existing exactly-once resolution. Persist actual native fee separately.</description>
  <tests-first>operation A evidence for B, duplicate attempt, concurrent finalizers, amount greater than reservation, stale lease, confirmed/reverted/ambiguous outcomes.</tests-first>
  <verification><command>npm run test:db -- phase2-reconciliation.test.ts && npm run test:concurrency -- phase2-reconciliation.test.ts</command><expected>one economic winner; invariant remains true.</expected></verification>
</task>

<task id="P2-05D" name="Prove the clean vertical slice">
  <description>From a seeded canonical intent, execute the complete autonomous-within-policy path and assert sender/recipient token balances, sender native fee delta, lifecycle, reservation, envelope, transaction, receipt, recovery, and audit correlation.</description>
  <tests-first>The E2E assertion is written before wiring orchestration; no direct seeding of AUTHORIZED/BROADCAST states is allowed.</tests-first>
  <verification><command>npm run test:chain -- vertical-slice.test.ts</command><expected>one transfer, one finalized spend, one reconciled operation, no secret output.</expected></verification>
</task>

**Non-goals:** replacement transactions, fee bumping, cancellation claims, public confirmations/reorg policy.

### P2-06 - Deterministic faults, adversarial proof, and S2 closeout

**Objective:** prove ambiguity safety and reproduce all Phase-2 faults without sleeps.

**Dependencies:** P2-05.

**Files:**

- Create: `tests/support/rpc-fault-proxy.ts`
- Create: `tests/support/phase2-barriers.ts`
- Create: `tests/fault/phase2-broadcast.test.ts`
- Create: `tests/fault/phase2-adversarial.test.ts`
- Create: `tests/concurrency/phase2-reconciliation.test.ts`
- Modify: `tooling/phase2-test-gate.mjs`, `package.json`, `.github/workflows/ci.yml`, `docs/TEST_MATRIX.md`, `docs/PROJECT_STATE.md`, `docs/CHANGELOG.md`

<task id="P2-06A" name="Build deterministic RPC fault proxy">
  <description>Implement method-aware barriers: refuse before send, explicit rejection, forward then drop response, return wrong hash/tx/receipt, delay receipt, crash hook around durable attempt. Never proxy non-loopback destinations.</description>
  <tests-first>proxy self-tests prove each fault and local-only refusal without timing sleeps.</tests-first>
  <verification><command>npm run test:fault -- rpc-fault-proxy.test.ts</command><expected>all barriers deterministically reach/release.</expected></verification>
</task>

<task id="P2-06B" name="Exercise broadcast and adapter crash matrix">
  <description>Cover RPC unavailable, rejection-before-acceptance, transmitted/response-lost, known hash/no receipt, duplicate broadcast, receipt revert, stale nonce, adapter crash before send/after send, and worker retry.</description>
  <tests-first>Each case asserts lifecycle, attempt classification, reservation status, and allowed retry action.</tests-first>
  <verification><command>npm run test:fault -- phase2-broadcast.test.ts</command><expected>unknown outcomes never release or re-sign.</expected></verification>
</task>

<task id="P2-06C" name="Exercise substitution and reconciliation matrix">
  <description>Cover wrong receipt/hash/recipient/amount/calldata/chain, stale simulation, insufficient gas, fee escalation, duplicate and concurrent reconciliation, local reset, and alternate signing attempts.</description>
  <tests-first>One adversarial fixture per field plus property mutations of all envelope-bound transaction fields.</tests-first>
  <verification><command>npm run test:adversarial && npm run test:concurrency -- phase2-reconciliation.test.ts</command><expected>all substitutions fail closed; exactly one economic effect.</expected></verification>
</task>

<task id="P2-06D" name="Close S2 evidence without overclaiming Phase 3">
  <description>Run a fresh current-head clean-room gate, record run identifiers/counts, audit for secrets/dependencies/security language, and update living documents. Do not mark Phase-3 integrated owner-approval/revocation recovery complete.</description>
  <verification><command>npm ci && npm run check && npm audit --audit-level=high && npm run dev:up && npm run dev:status && npm run contracts:test && npm run fixture:phase2 && npm run test:db && npm run test:concurrency && npm run test:invariants && npm run test:chain && npm run test:fault && npm run test:adversarial && npm run dev:down</command><expected>every command exits 0; current-head protected CI and secret scan pass.</expected></verification>
</task>

**Commit boundaries:** fault harness; broadcast faults; adversarial/concurrency; evidence/docs closeout.

**Non-goals:** browser/MCP/CLI E2E, external RPC faults, production reorg/finality claims, S2 PASS before protected evidence and review.

## 9. Dependency Graph

```text
P2-01
  -> ADR-0015 acceptance
       -> P2-02 -> P2-03 -> P2-04 -> P2-05 -> P2-06
```

- P2-01 contract tests and ADR-0015 review may run in parallel because they touch separate files and authority.
- P2-02 through P2-05 are sequential: they share envelope fields, lifecycle evidence, and security state.
- Within P2-06, fault-proxy self-tests precede broadcast/adversarial tests; broadcast and substitution suites may then run in parallel if they use isolated Anvil resets/databases.
- No packet that touches envelope v2, migration 0022, adapter API, or reconciliation may begin before the preceding contract is reviewed and stable.

## 10. Implementation-Oriented Test Matrix

| Requirement | Test | Suite | Packet | Expected evidence |
| --- | --- | --- | --- | --- |
| S0/S1 inherited | existing complete gates | repository/unit/DB/concurrency/invariant | every packet | no regression from accepted counts/invariants |
| local chain only | wrong chain/public host/reset fixture | repository + chain | P2-01/P2-03 | fail before deployment/RPC/sign |
| deterministic fake token | build/deploy/code hash/balances | Forge + chain | P2-01 | fixed artifact and fixture fingerprint |
| exact construction | known calldata vector | unit | P2-02 | selector/address/uint256 bytes |
| independent verification | per-field mutations and malformed ABI | unit/property | P2-02 | typed fail-closed mismatch |
| mandatory simulation | success/revert/insufficient token | chain | P2-03 | canonical block-bound evidence hash |
| native fee separation | insufficient gas/ceiling/drift | unit + chain + invariant | P2-03 | ERC-20 ledger unchanged by fee |
| stale simulation | nonce/balance/block/reset changes | chain | P2-03/P2-06 | REVALIDATION_REQUIRED, no sign |
| immutable authorization | v2 DB hash/revision/fence guards | DB | P2-04 | stale/mutated envelope rejected |
| signer isolation | forbidden API/key/log tests | unit + chain | P2-04 | IDs-only API; no secret/raw bytes |
| wrong-chain signing | adapter context mismatch | chain/adversarial | P2-04/P2-06 | refusal before signature |
| response-loss ambiguity | forward/drop RPC response | fault | P2-05/P2-06 | UNKNOWN/DISPUTED; reservation retained |
| duplicate broadcast | resend exact bytes | fault | P2-06 | same hash, no second economic effect |
| receipt matching | wrong hash/from/to/input/log/chain | unit + fault | P2-05/P2-06 | mismatch disputed |
| confirmed reconciliation | successful receipt | DB + chain E2E | P2-05 | token spend finalized once |
| definitive revert | status 0 plus matched tx | chain + DB | P2-05 | zero token spend, safe release through evidence |
| duplicate/concurrent reconcile | repeated/simultaneous claims | DB + concurrency | P2-05/P2-06 | one winner; invariant preserved |
| complete trace/audit | correlated operation timeline | E2E | P2-05/P2-06 | all IDs/hashes, no secrets |

## 11. Threat Review

| Threat | Prevention | Detection/test | Residual risk | Owner |
| --- | --- | --- | --- | --- |
| transaction/calldata substitution | v2 immutable fields + strict independent parser | per-field mutations | compromised constructor and verifier process can collude | P2-02 |
| self-verification weakness | no shared ABI decoder; known vectors | differential/malformed vectors | both implementations may share spec misunderstanding | P2-02 |
| signer API abuse/key leak | IDs-only IPC, separate process, redaction | forbidden-method and output scan | full host compromise defeats local key isolation | P2-04 |
| wrong chain/local reset | chain/genesis/fixture/code fingerprint at every boundary | wrong-chain/reset tests | local RPC can lie consistently | P2-01/03/04/05 |
| stale simulation/nonce race | block+nonce+balance/fee pre-sign recheck | barriers mutate each input | state may change immediately after check; nonce-bound signed tx and receipt matching limit impact | P2-03/04 |
| fee manipulation | exact type-2 fee fields and maximum-cost checks twice | escalation vectors | actual fee below ceiling still variable | P2-03/04 |
| replay/duplicate broadcast | nonce + precomputed hash + durable attempts | duplicate/send-loss tests | repeated exact raw tx may return provider-specific errors | P2-05/06 |
| false failure releases budget | only authenticated definitive pre-broadcast proof releases | response-loss/crash tests | prolonged uncertainty holds funds | P2-05/06 |
| receipt/cross-operation substitution | full transaction+receipt+log and DB FK/unique binding | wrong evidence for operation B | single compromised DB+reconciler remains TCB | P2-05 |
| RPC compromise | treat RPC as untrusted, local identity and consistency checks | malformed/mismatch proxy | one local RPC is not Byzantine independent | P2-03/05 |
| alternate authorization path | signer loads canonical evidence; DB guards | direct state/API abuse tests | bugs in shared authorization TCB | P2-04 |
| secret logging | structured allowlist logging, no raw tx/private key | captured stdout/stderr scan | process memory remains sensitive | P2-04/06 |
| testnet/mainnet escape | no URL input; local-runtime loader and chain pin | public URL/chain tests | operator modifying code defeats local proof | every packet |

## 12. S2 Closeout Checklist

- [ ] Proposed ADR-0015 accepted; no accepted ADR edited to change meaning.
- [ ] Fresh clone/current head installs with lockfile and zero high vulnerabilities.
- [ ] Existing S0/S1 repository, unit, DB, concurrency, and invariant gates pass unchanged.
- [ ] Anvil is loopback-only 31337 and fixture fingerprint/code hash is reproduced after clean reset.
- [ ] Exactly one canonical autonomous transfer completes every governing state in order.
- [ ] Constructor and independent decoder use separate implementations and all mutation vectors fail closed.
- [ ] Simulation evidence is block/nonce/balance/fee bound; stale evidence cannot sign.
- [ ] Native maximum fee is enforced twice and never touches ERC-20 budget accounting.
- [ ] Signer process accepts IDs only; no raw/message/typed signing; no secret/raw bytes in API/log/audit/fixture.
- [ ] Expected transaction hash is durable before send; response loss remains uncertain.
- [ ] Transaction, receipt, block, and Transfer log exactly match envelope/operation/reservation.
- [ ] Success finalizes once; verified pre-broadcast failure/revert releases safely; ambiguity/mismatch disputes and retains.
- [ ] All 21 required fault cases pass deterministically without sleep races.
- [ ] Complete correlated append-only audit timeline exists and contains no prohibited data.
- [ ] Protected current-head CI and secret scan pass and evidence IDs/counts are recorded in `docs/TEST_MATRIX.md`.
- [ ] Independent reviewer confirms no public/testnet/mainnet/real-fund/production-custody path and no Phase-3 overclaim.

## 13. Open Questions

### Blocking

1. Product owner must accept, reject, or revise proposed ADR-0015. Evidence: envelope v1 in `packages/schemas/src/envelope.ts` lacks resolved nonce, transaction type, max priority fee, and simultaneous simulation block number/hash. Signing before these are immutable would contradict the Product Spec exact intent/execution binding and ADR-0003.

### Non-blocking

- P2-01 records the exact `viem`, Forge, and Solc versions after current package/image inspection. Version selection does not alter the boundary above.
- P2-03 selects and documents the smallest deterministic gas-limit margin and maximum simulation block age through tests; both remain bounded by the immutable fee ceiling and stale-state rule.
- P2-04 may choose child-process stdio or a mode-0600 Unix socket after testing platform reliability. The API remains IDs-only and loopback/local regardless.

## 14. Handoff to P2-01

Start from the accepted planning commit on `phase-2/ws-004-local-erc20`. Load Shipyard executing-plans, TDD, infrastructure-validation, Solidity-security, security-audit, and verification skills. Read P2-01 and ADR-0015 first. Implement only P2-01A, beginning with failing Forge tests in `contracts/test/MockERC20.t.sol`; use the existing digest-pinned Foundry container and existing `loadLocalRuntime` safety boundary. Do not add `viem`, migrations, transaction-pipeline code, signer code, public RPC configuration, or any real-wallet material in P2-01. Stop after each task's listed verification and focused commit. P2-02 remains blocked until ADR-0015 is accepted.
