# Phase 2 - Local EVM Vertical Slice / Gate S2 Implementation Plan

> **For implementation agents:** use Shipyard's executing-plans workflow and implement this plan packet by packet. ADR-0015 is **ACCEPTED**. P2-02 is no longer blocked on architecture approval, but it must not begin until P2-01 has been reviewed and its fixture/toolchain contract is stable.

**Goal:** prove one deterministic fake ERC-20 transfer through `construct -> independently decode/verify -> simulate -> authorize -> locally sign -> broadcast -> confirm -> reconcile` on clean local Anvil without weakening S0/S1.

**Architecture:** Phase 2 extends the existing canonical intent, policy, reservation, envelope, approval/control, authenticated-component, recovery, and audit path. A provider-neutral pipeline creates a typed transaction candidate; a deliberately separate strict decoder verifies its transfer bytes; simulation resolves the exact local EVM execution context; final policy + atomic reservation produce an immutable envelope v2; and a restricted local signer process signs only that DB-authorized exact transaction. Broadcast and reconciliation treat transport failure as uncertainty and consume operation-bound, authenticated verification of untrusted chain evidence exactly once.

**Tech stack:** strict TypeScript/Node.js workspaces, PostgreSQL 17, Vitest/fast-check, the existing digest-pinned Foundry/Anvil/Forge image, Solidity, `viem` beginning in P2-02, existing `@noble/hashes`, Zod, and the existing Ed25519 component-authentication boundary.

**Status:** P2-02 through P2-04 are integrated on `integration/p2-05`; P2-05A/B/C are reviewed and integrated; P2-05D is implemented on `integration/p2-05d` and READY FOR EXTERNAL ACCEPTANCE REVIEW. P2-06A remains separate test infrastructure; P2-06B/C/D have not started. ADR-0015, ADR-0016 and ADR-0017 are accepted. Gate S2 remains **OPEN / NOT PASSED**.

---

## 1. Baseline and inherited authority

- Branch: `phase-2/ws-004-local-erc20`.
- Accepted `main` baseline / Phase-2 branch point: `f733a41ed16c44ad631f0a5a4b52e8096ab70eed`.
- Planning commit: `51a0ba471d9dbc829821b474782183206902cff8`.
- PR: #5, open draft.
- Accepted gates: S0 PASS; S1 PASS / ACCEPTED; S2 OPEN / NOT PASSED.
- Existing packages to consume: `packages/schemas`, `packages/policy-engine`, `packages/budget-ledger`, `packages/approvals`, `packages/audit`, and `packages/trust-boundary`.
- Existing migrations: forward-only `0001` through corrective `0021`; never edit their meaning/checksums.
- Existing Phase-1 handoff: an operation/reservation in `AUTHORIZED`, immutable `authorization_evidence`, one current envelope revision, no active invalidation, and matching ACTIVE system/owner/agent/policy fence snapshots.
- Existing execution evidence: `reservation_broadcast_evidence`, `trusted_component_credentials`, `operation_recovery_leases`, and `recovery_attempts` already provide authenticated adapter/reconciler identity, ambiguity-safe recovery primitives, and exactly-once economic transitions.
- Inherited financial invariant: `allocated = available + reserved + finalized_spend` for one ERC-20 atomic-unit tuple. Native fees never enter this tuple.
- Inherited safety: strict schemas; deterministic/domain-separated hashes; immutable envelopes/decisions; serializable ledger changes; one authorization core; local-only `eip155:31337`; no raw/message/typed-data signing surface.

### Actual Phase-1 authorization path

| Stage | Input/output | Persistence and authority |
| --- | --- | --- |
| Intent | `canonicalIntentSchema` -> typed `asset.transfer`; domain-separated idempotency payload hash | immutable `intents`; identity is DB-bound |
| Policy | deterministic `evaluatePolicy(...)` -> decision + Keccak decision hash | immutable `policy_decisions`; chain/asset/recipient/action/token budget/native-fee rules already exist |
| Reservation | `reserveBudget` -> `HELD` under SERIALIZABLE transaction | `budget_accounts`, `budget_reservations`, `idempotency_records`; shared control-fence lock prefix |
| Envelope | final verified/simulated candidate + decision/reservation -> hash-bound immutable revision | immutable `execution_envelopes`; DB recomputes schema/hash/bindings/lineage |
| Approval/control | authenticated owner decision or canonical autonomous authorization | rows bind envelope/policy/reservation/fence snapshot; caller identity is not authority |
| Authorization | one-time consumption -> operation/reservation `AUTHORIZED` + immutable evidence | canonical DB guard rejects stale/superseded/invalidated/fence-mismatched authority |
| Recovery | authenticated adapter/reconciler evidence + fenced recovery lease | CONFIRMED finalizes; authoritative pre-broadcast FAILED may release; AMBIGUOUS/CONFLICT disputes and retains |

**Exact local Phase-2 signing handoff:** the local-Anvil signer accepts only operation/authorization references, loads the current envelope/reservation/authorization from PostgreSQL, and revalidates canonical authority immediately before signing. It never accepts caller-provided transaction fields or raw bytes. This is the reference-adapter mechanism, not a universal requirement that future provider adapters directly access PostgreSQL.

### ADR dependency map

```text
ADR-0001 provider-neutral/local-only -> ADR-0009 adapter/signer -> ADR-0004 enforcement grades
ADR-0002 atomic reservation -> ADR-0006 fee separation -> ADR-0003 envelope lifecycle/hash
ADR-0003 immutable envelope -> ADR-0005 pre-sign controls -> ADR-0008 approval binding
ADR-0010 transactional audit -> ADR-0014 authenticated evidence -> ADR-0011 recovery leases
ADR-0001 single core -> ADR-0012 minimal interfaces
ADR-0007 TypeScript/PostgreSQL/Vitest constrains every packet
ADR-0015 ACCEPTED -> exact envelope v2 / type-2 fields / simulation freshness / local signer / persist-before-send / authenticated reconciliation
ADR-0015 ACCEPTED -> exact envelope v2 / type-2 fields / simulation freshness / local signer / persist-before-send / authenticated reconciliation
```

---

## 2. Architecture summary

```text
UNTRUSTED AGENT / TEST DRIVER
  canonical intent + idempotency key only
              |
              v
+---------------- CONTROL-PLANE TCB ----------------+
| schema -> policy precheck -> transfer-core builder |
|                         |                          |
| viem encodeFunctionData |                          |
|                         v                          |
|             strict independent decoder            |
|            (manual selector/word parser)           |
|                         |                          |
|                         v                          |
| local RPC simulation @ canonical block            |
| resolve nonce/gas/type-2 fees/accessList=[]        |
| final exact-candidate verification                 |
|                         |                          |
| final policy -> atomic reservation -> envelope v2 |
| -> existing approval/autonomous authorization     |
+-------------------------+--------------------------+
                          | operationId + authorizationId
                          | local authenticated process boundary
                          v
+---------------- LOCAL ANVIL SIGNER ----------------+
| reload immutable envelope v2 + canonical authority|
| revalidate fences/expiry/fixture/simulation/fees   |
| sign exact type-2 transaction; no caller fields    |
| derive expected tx hash; no raw bytes leave signer |
+-------------------------+--------------------------+
                          | persist expected hash + STARTED attempt
                          | then eth_sendRawTransaction
                          v
+---------------- UNTRUSTED RPC BOUNDARY ------------+
| loopback-only Anvil 31337 -> fake ERC-20           |
+-------------------------+--------------------------+
                          | tx + receipt + block/log evidence
                          v
+---------------- RECONCILER TCB --------------------+
| match operation/reservation/envelope/hash/fields   |
| verify canonical block + exact Transfer evidence   |
| authenticate normalized result under ADR-0014      |
| lease-fenced exactly-once ledger resolution        |
+----------------------------------------------------+
```

The RPC is evidence input, never authorization. The constructor is not its own verifier. Simulation success is not authorization. The signer is not a policy engine. The local signer's DB access is not a universal provider-adapter requirement. A receipt alone cannot reconcile funds.

---

## 3. Accepted design decisions

### D1 - Envelope v2 is additive and hash-domain separated

- Envelope v1 remains exactly `schemaVersion: "1.0"` with hash-preimage version `v1`; its parsing, persisted rows, and golden vectors are frozen Phase-1 evidence.
- Envelope v2 is `schemaVersion: "2.0"` with hash-preimage version `v2` under the existing envelope hash domain.
- Validation/hashing dispatches by envelope version; do **not** change the global/shared Phase-1 `versionSchema` literal to redefine v1.
- V2 binds every unsigned type-2 transaction field: chain/from/to/value/calldata, resolved nonce, `transactionType: "eip1559"`, gas limit, max priority fee, max fee, and `accessList: []`.
- V2 also binds canonical simulation block number/hash and the existing decision/reservation/policy/expiry/risk/approval fields.
- Any bound-field change supersedes the envelope and invalidates its authorization under ADR-0003.

### D2 - EIP-1559 only for this slice

- Phase 2 supports only type-2 EIP-1559 transfers.
- `accessList` is explicitly bound to `[]`; a non-empty access list fails closed.
- Legacy, blob, EIP-7702/authorization-list, and other transaction-family fields are unsupported.
- Maximum authorized native fee is `gasLimit * maxFeePerGas`, bounded by the lower of intent and active-policy ceilings.
- Actual native fees are evidence only and never reduce ERC-20 delegated budget.

### D3 - Use `viem` for EVM mechanics, not authority

- Select and lock one reviewed `viem` version in P2-02.
- Allowed responsibilities: typed RPC, `encodeFunctionData`, type-2 transaction serialization/signing, transaction/receipt/block access.
- Forbidden responsibilities: intent normalization, policy decisions, independent calldata verification, authorization, budget decisions, reconciliation decisions, or unconstrained nonce/fee selection.
- Do not add `ethers` solely for independent decoding and do not hand-roll secp256k1/RLP/type-2 signing.

### D4 - Independent transfer verification is deliberately separate

- Constructor uses `viem.encodeFunctionData` for `transfer(address,uint256)`.
- Independent decoder imports no ABI encoder/decoder and accepts exactly 68 bytes: selector `0xa9059cbb`, canonical zero-left-padded address word, and uint256 amount word.
- Unknown selector, malformed/non-lowercase/non-canonical hex, non-zero address padding, truncation, trailing bytes, opaque calldata, extra calls, or any intent/transaction mismatch fails closed.

### D5 - Distinguish the static transfer core from the resolved executable candidate

The governing sequence remains construct -> decode -> verify -> simulate. Dynamic EVM fields are not invented early merely to make P2-02 self-contained.

1. **Transfer-core candidate**: trusted chain/from/token target + canonical intent -> to/value/calldata + nonce strategy; independently decode and verify the static transfer identity.
2. **Simulation/execution resolution**: P2-03 obtains canonical block identity, resolved pending nonce, gas estimate/limit, type-2 fee fields, `accessList: []`, and balance/fee evidence.
3. **Final exact-candidate verification**: before final policy/reservation/envelope, verify the resolved executable fields against the already-verified transfer core, simulation evidence, chain/fixture identity, and fee constraints.
4. **Envelope v2**: only after final policy and reservation exist, hash the exact resolved executable candidate + simulation + decision/reservation bindings.

This avoids the contradiction of asking P2-02 to verify gas/nonce fields that P2-03 has not resolved yet.

### D6 - Simulation is canonical and bounded, not invalidated by every new head

- Pin simulation evidence to local chain `31337`, current fixture instance, canonical block number/hash, sender pending nonce, token/native balances, exact call, gas result, and fee evidence.
- A newer head block **alone** does not invalidate a still-canonical simulation inside the configured freshness window.
- Re-simulation is required when the simulation block becomes non-canonical/too old; resolved nonce changes; token/native balance assumptions no longer hold; fee conditions exceed the authorized ceiling; fixture instance changes; executable fields change; or another simulation precondition changes.
- Pause/revocation/expiry/policy/approval/fence failures fail closed at the governing pre-sign revalidation boundary; they do not create a signing bypass.

### D7 - No persistent unauthorizable transaction-candidate source of truth

- P2-02 candidate objects are strict typed in-memory values plus audit-safe hashes/events.
- Do **not** introduce a `transaction_candidates` table merely for convenience.
- Durable execution evidence begins with normalized simulation evidence and the existing operation lifecycle; the immutable envelope remains the transaction authorization source of truth.
- If later implementation discovers a concrete recovery requirement for pre-envelope candidate persistence, stop and document the requirement rather than silently creating a second transaction identity source.

### D8 - The local signer is capability-shaped and reference-adapter-specific

- Local process loads one disposable Anvil test account from ignored local state or avoids extracting the key when the local fixture can use Anvil's unlocked dev account.
- Product signing in P2-04 accepts IDs only, reloads the DB-authorized envelope, and cannot accept raw transaction fields.
- No raw transaction/message/digest/`personal_sign`/typed-data method exists.
- No private key in argv, logs, API results, repo files, screenshots, or audit data.
- Future Safe/MetaMask/Turnkey/etc. adapters may use a different reviewed transport; they must preserve provider-neutral authorization semantics and cannot infer policy authority from this local DB mechanism.

### D9 - Persist expected transaction identity before crossing the ambiguous RPC boundary

- Sign exact envelope-v2 bytes locally.
- Derive the expected transaction hash from final signed bytes.
- Durably persist signed evidence + expected hash, then persist a `STARTED` broadcast attempt bound to operation/reservation/envelope/authorization **before** `eth_sendRawTransaction`.
- Matching RPC hash -> accepted/known broadcast.
- Explicit proven pre-acceptance rejection -> rejected candidate for authoritative failure classification.
- Timeout, response loss, transport exception, missing response, or contradictory hash -> UNKNOWN/CONFLICT, never proof of non-execution.
- Never reconstruct/re-sign just because the caller did not receive a response.

### D10 - Chain evidence is untrusted; ADR-0014 remains the reconciliation authority

- Fetch expected-hash transaction, receipt, canonical block and ERC-20 logs.
- Verify chain/fixture identity and all bound transaction fields.
- Require exactly the expected fake-token `Transfer` evidence for successful transfer reconciliation.
- Receipt status 0 is verified execution failure; actual ERC-20 transferred spend is zero while native gas remains separate evidence.
- Normalize the conclusion, then authenticate the reconciler action using the existing active ADR-0014 RECONCILER credential/domain-separated payload.
- Only after that authentication may the existing recovery lease / exactly-once ledger resolution mutate financial state.

### D11 - Local reset identity needs a per-fixture instance marker

Deterministic Anvil can recreate the same chain ID, genesis, accounts, contract address, bytecode and even transaction hashes after reset. Those values alone are insufficient to distinguish execution epochs when PostgreSQL state survives a local Anvil restart.

P2-01 therefore generates a new non-secret `fixtureInstanceId` (for example a cryptographically random UUID) every time the Phase-2 token fixture is freshly deployed. The fixture fingerprint contains that ID plus checkout/chain/genesis/deployment/code metadata. P2-03/P2-04/P2-05 evidence must bind the current fixture instance. A reset/redeploy creates a new instance ID even when deterministic addresses/code repeat, making old execution evidence stale by construction.

### D12 - One Anvil inclusion is local evidence, not production finality

One included canonical block is sufficient for deterministic local S2 confirmation after full transaction/receipt/log matching. This makes no public-network reorg/finality guarantee.

---

## 4. Dependency and tooling decisions

### Selected

| Dependency/tool | Responsibility | Must not own | When locked |
| --- | --- | --- | --- |
| Existing Foundry image pinned by digest | Forge build/test and local Anvil | public RPC/provider/custody | already pinned; P2-01 records embedded Forge/Anvil/Solc versions |
| Minimal in-repo Solidity fake token | deterministic transfer target + deliberate test revert seam | production token/admin/proxy semantics | P2-01 |
| `viem` exact locked version | EVM ABI construction, typed RPC, type-2 serialization/signing, tx/receipt/block access | policy/authorization/independent decode/reconciliation decisions | P2-02 |
| Existing `@noble/hashes` | envelope/evidence hashing where already appropriate | EVM transaction signing | existing |

### Rejected

- `ethers` as a second decoder: unnecessary dependency surface; independence comes from a tiny strict parser.
- Raw `fetch` + hand-written secp256k1/RLP/type-2 serialization: unacceptable correctness/crypto risk.
- Hardhat: unnecessary second framework; Foundry is already pinned.
- OpenZeppelin runtime dependency for this tiny fixture: unnecessary for the transfer-only fake target.
- `solc` npm package: duplicate compiler management; use pinned Foundry tooling and an explicit `solc_version`.

### Context7 research baseline

Planning research covered current APIs/behavior for `/wevm/viem`, `/foundry-rs/foundry`, `/openzeppelin/openzeppelin-contracts`, and `/ethers-io/ethers.js`. Implementation agents must re-check the exact selected version/API before adding a new dependency; version-current documentation beats memory.

**Version ownership correction:** P2-01 records only the existing Foundry image digest and actual Forge/Anvil/Solc versions. P2-02 selects and locks the exact `viem` version, updates the lockfile, and runs dependency/security review.

---

## 5. Data model impact

### Reused unchanged

`intents`, `operations`, `policy_decisions`, `budget_accounts`, `budget_reservations`, `idempotency_records`, `execution_envelopes`, `approval_requests`, `approval_decisions`, `authorization_evidence`, `authorization_invalidations`, `control_fences`, `trusted_component_credentials`, `reservation_broadcast_evidence`, `operation_recovery_leases`, `recovery_attempts`, and `audit_events` remain the canonical Phase-1 state model.

The existing lifecycle already contains CONSTRUCTED, DECODED, VERIFIED, SIMULATED, POLICY_FINALIZED, BUDGET_RESERVED, ENVELOPE_FINALIZED, AUTHORIZED, SIGNING, SIGNED, BROADCAST, PENDING_CONFIRMATION, CONFIRMED, RECONCILED, failure states, DISPUTED, and REVALIDATION_REQUIRED. **Do not add lifecycle enum values** merely to mirror internal substeps. Broadcast attempt rows carry attempt-level state while the operation remains SIGNED until known acceptance.

### Additive schemas

- `executionEnvelopeV2Schema`: `schemaVersion: "2.0"`, distinct v2 hash-preimage version, all v1 economic/identity fields plus resolved nonce, `transactionType: "eip1559"`, `maxPriorityFeePerGas`, `accessList: []`, `simulationBlockNumber`, and `simulationBlockHash`.
- `transferCoreCandidateSchema`: pre-simulation typed transfer identity and provenance.
- `decodedTransferSchema` / `transferCoreVerificationResultSchema`: independent fail-closed decode/static verification.
- `executableTransferCandidateSchema` / exact verification result: resolved nonce/gas/type-2 fee/access-list fields after P2-03.
- `simulationEvidenceSchema`: fixture instance, chain, block number/hash, candidate hash, sender nonce, balances, gas/fees, outcome/revert, expected deltas, simulator version, evidence hash.
- `signAuthorizedTransferRequestSchema`: operation/authorization IDs plus adapter request ID only for the local-Anvil implementation.
- `broadcastAttemptSchema`, `chainTransactionEvidenceSchema`, `chainReceiptEvidenceSchema`: normalized immutable execution evidence without private keys/raw signed bytes.

### Forward migration `0022_ws004_evm_execution_evidence.sql`

P2-04 owns the migration, after P2-02/P2-03 contracts are stable.

- Extend envelope validation by **version dispatch**: preserve exact v1 validation/hash semantics and add v2 validation/hash semantics. Never change what schema/hash v1 means.
- Extend audit-event CHECK values for construction, independent verification, simulation, signing, broadcast attempt/known, confirmation/mismatch and reconciliation events.
- Create `local_chain_fixtures` (or an equivalently narrow table) for the accepted current local fixture instance: fixture instance ID, checkout identity, chain ID, genesis/block-0 hash, token address/code hash, deployment transaction/block identity and safe toolchain metadata. No key material.
- Create `transaction_simulations` keyed by a simulation ID with operation ID, transfer-core candidate hash, fixture instance ID, chain/block identity, sender nonce, token/native balances, gas/fee fields, normalized outcome and evidence hash. Simulation precedes envelope creation, so do **not** key the row by an envelope revision that does not yet exist.
- Do not create a persistent `transaction_candidates` table without a separately demonstrated recovery requirement.
- Create `signed_transactions` bound one-to-one to operation/reservation/envelope/authorization/current fixture with expected transaction hash, signer component identity and signed-at time; never raw bytes/private material.
- Create `broadcast_attempts` keyed by attempt ID and expected hash with STARTED/ACCEPTED/REJECTED/UNKNOWN/CONFLICT classification under guarded transitions. A durable send-capable attempt fences Phase-1 release paths; a valid contradictory returned hash is CONFLICT, while response loss remains UNKNOWN.
- Create normalized `chain_transaction_evidence` and `chain_receipt_evidence` bound to operation/reservation/envelope/expected hash/current fixture/canonical block.
- Add uniqueness and FK/constraint guards preventing a transaction hash/evidence row from crossing operation/reservation/envelope identity and preventing more than one economic reconciliation effect.
- Require current canonical authorization before SIGNING/SIGNED and matching authenticated execution evidence for downstream financial transitions.

Migration is additive/forward-only and must not alter migrations `0001`-`0021`.

---

## 6. API and interface contracts

```ts
type ConstructTransferCore = (
  intent: CanonicalTransferIntent,
  trusted: {
    walletAddress: Address;
    tokenAddress: Address;
    chainId: "eip155:31337";
    fixtureInstanceId: string;
  },
) => TransferCoreCandidate;

type DecodeTransferIndependent = (calldata: Hex) =>
  | { ok: true; selector: "0xa9059cbb"; recipient: Address; amountAtomic: string }
  | { ok: false; code: DecodeFailureCode };

type VerifyTransferCore = (
  intent: CanonicalTransferIntent,
  candidate: TransferCoreCandidate,
  decoded: DecodedTransfer,
  trusted: TrustedExecutionContext,
) => TransferCoreVerificationResult;

type SimulateAndResolveTransfer = (
  verified: VerifiedTransferCore,
  rpc: LocalReadRpc,
  fixture: LocalFixtureIdentity,
) => Promise<{ executable: ExecutableTransferCandidate; simulation: SimulationEvidence }>;

type VerifyExecutableTransfer = (
  verifiedCore: VerifiedTransferCore,
  executable: ExecutableTransferCandidate,
  simulation: SuccessfulFreshSimulation,
  constraints: ActiveFeeAndExecutionConstraints,
) => ExactVerificationResult;

type FinalizeEnvelopeV2 = (
  executable: ExactVerifiedTransfer,
  simulation: SuccessfulFreshSimulation,
  decision: PolicyDecision,
  reservation: ReservationSnapshot,
) => ExecutionEnvelopeV2;

interface AdapterCapabilitySurface {
  manifest(): AdapterCapabilityManifest;
  recoverTransaction(request: NormalizedRecoveryRequest): Promise<NormalizedChainEvidence>;
}

interface LocalAnvilExecutionAdapter extends AdapterCapabilitySurface {
  signAuthorizedTransfer(request: {
    operationId: string;
    authorizationId: string;
    adapterRequestId: string;
  }): Promise<{ transactionHash: Hash }>;
}

type ReconcileTransfer = (
  claim: AuthenticatedReconcilerClaim,
  evidence: VerifiedChainEvidence,
) => Promise<RecoveryResolution>;
```

Trust direction:

- Agent intent/hints are untrusted until schema/policy validation.
- Trusted wallet/token/fixture identity comes from Crip local configuration/state, never symbol/decimal hints.
- Constructor output is untrusted input to the independent decoder/verifier.
- RPC simulation/transactions/blocks/receipts/logs are untrusted evidence and must be cross-checked.
- Adapter manifests are claims checked against required enforcement grades.
- Local signer trusts only DB-loaded immutable envelope + current canonical authorization/fences, never caller transaction data.
- Reconciler trusts neither actor labels nor a receipt alone; ADR-0014 component authentication + operation-bound verified evidence are mandatory.

---

## 7. State-transition mapping

```text
POLICY_PRECHECKED
  -> CONSTRUCTED -> DECODED -> VERIFIED
  -> SIMULATED
       | failure/revert/balance/fee -> SIMULATION_FAILED (no reservation)
       | simulation precondition stale -> REVALIDATION_REQUIRED -> rebuild/re-simulate
  -> POLICY_FINALIZED -> BUDGET_RESERVED -> ENVELOPE_FINALIZED
  -> AWAITING_APPROVAL -> AUTHORIZED   (review mode)
  -> AUTHORIZED                         (autonomous mode through same evidence guard)
  -> SIGNING
       | definitive pre-sign/no-bytes failure -> SIGNING_FAILED; release only under governing safe-failure rules
       | stale fence/authorization/nonce/simulation/fixture/fee -> REVALIDATION_REQUIRED; no signature
  -> SIGNED
       | crash/uncertain signed state -> DISPUTED; prove non-execution before release
       | STARTED broadcast attempt only -> remains SIGNED
  -> BROADCAST
  -> PENDING_CONFIRMATION
       | receipt absent/response lost -> remain pending or DISPUTED; never release solely on timeout
       | verified receipt status 0 -> REVERTED; token spend zero, native fee evidence separate
       | mismatch/wrong chain/hash/fixture -> DISPUTED
  -> CONFIRMED -> RECONCILED
```

`BROADCAST_FAILED` is reserved for an authoritative pre-acceptance failure classification with proof the expected transaction did not execute. A generic transport exception is UNKNOWN, not failure.

---

## 8. Work packets

### P2-01 - Deterministic local fake ERC-20 fixture

**Objective:** establish reproducible Solidity build/deploy/reset artifacts on only the existing checkout-bound Anvil and create a unique fixture execution epoch that later evidence can bind.

**Dependencies:** S1 accepted. ADR-0015 is accepted but P2-01 does not implement envelope/signing behavior.

**Likely files:**

- Create: `contracts/foundry.toml`
- Create: `contracts/src/MockERC20.sol`
- Create: `contracts/test/MockERC20.t.sol`
- Create: `contracts/script/DeployMockERC20.s.sol` only if the final deploy path needs it
- Create: `tooling/phase2-contracts.mjs`
- Create: `tooling/phase2-fixture.mjs`
- Create: `tests/chain/fixture.test.ts`
- Modify only as required: `package.json`, `.github/workflows/ci.yml`, `.gitignore`, `docs/TESTING.md`

#### P2-01A - Pin contract toolchain and fake token

- Start with red Forge tests.
- Minimal six-decimal fixed-supply fake token with `Transfer`, `balanceOf`, `totalSupply`, transfer success, insufficient-balance failure, zero-address failure and one explicit deterministic test-only revert seam.
- No Permit/Permit2, admin mint-after-deploy, proxy, upgradeability, fees, rebasing, blacklist, hooks, arbitrary callback or production token surface.
- Use the existing digest-pinned Foundry image; pin Solidity compiler version in `foundry.toml`.
- Record actual Forge/Anvil/Solc versions. The digest fixes image content; changing that digest is an explicit dependency change, not incidental drift.

**Verification:** `npm run contracts:test` must run Forge through the repository-managed container and fail if the test suite is missing/failing.

#### P2-01B - Deploy and verify checkout-bound fixture
**P2-01 evidence:** `npm run contracts:test` passes 10/10 Forge tests; `npm run fixture:phase2` creates the mode-0600 fixture; `npm run test:chain -- fixture.test.ts` passes 9/9 local fixture and boundary tests, including reset → redeploy with a new fixture instance and stale rejection of the prior instance. Protected CI `33189082028` and Secret Scan `33189082181` pass on implementation head `25e8147f`. The chain gate is fail-closed for missing or out-of-scope suites, and fixture regeneration requires a clean Anvil reset. This packet evidence does not claim S2 completion.

**Commit boundaries:** `build: add pinned fake ERC-20 fixture`; `test: prove local fixture safety`.

- Load the authoritative `.local/runtime.env` and existing checkout identity; reject non-loopback RPC, wrong chain, stopped/malformed runtime or different checkout.
- Prefer deployment through Anvil's local unlocked disposable dev account so the fixture tooling need not extract a private key at all. If the exact pinned Foundry path cannot support that safely, use a separately reviewed stdin/inherited-FD/local-secret mechanism. Never private key in argv, process environment, logs, fixture JSON or repository files.
- Verify chain `31337`, deployment transaction/receipt, runtime bytecode hash, token metadata/decimals/supply and deployer balance.
- Generate a new non-secret cryptographically random `fixtureInstanceId` on every fresh fixture deployment, even if deterministic reset reproduces the same genesis/address/code/tx hash.
- Write mode-0600 `.local/phase2-fixture.json` containing the fixture instance ID, checkout hash/project identity, chain ID, safe RPC endpoint identity, genesis/block-0 hash, deployer address, token address, code hash, metadata/decimals/supply, deployment tx hash + block number/hash, Foundry/Forge/Anvil/Solc versions and safe timestamps. No private key/mnemonic.
- Fixture validation must reject stale instance/runtime mismatch, absent/wrong code, wrong metadata/supply, wrong checkout, public host, wrong chain and malformed generated state.

**Required P2-01 tests:**

- positive token metadata/supply/transfer/event behavior;
- contract revert/insufficient balance/zero-address behavior;
- loopback + chain pin;
- deployed bytecode/code hash + fixture contents;
- mode-0600 generated state and secret-output scans;
- wrong host/chain/checkout/malformed runtime rejection;
- clean reset/redeploy produces a valid **new fixtureInstanceId** and invalidates the prior fixture instance even if deterministic EVM identifiers repeat.

**P2-01 non-goals:** `viem`, envelope schema v2, migrations, transaction-pipeline package, product signer, public RPC, real-wallet material.

**Packet acceptance:** focused tests + inherited `npm ci`, `npm run check`, high dependency audit, local runtime status, DB/concurrency/invariant regression suites, cleanup, protected CI and Secret Scan. Do not mark S2 PASS.

### P2-02 - Static construction, independent verification and envelope-v2 contract

**Objective:** establish the additive v2 schema/hash contract and prove independent verification of the intent-derived transfer core. Do not fake dynamic nonce/gas/fee fields before P2-03.

**Dependencies:** P2-01 reviewed/stable; ADR-0015 accepted.

**Likely files:**

- `packages/transaction-pipeline/{package.json,tsconfig.json}`
- `packages/transaction-pipeline/src/{candidate,construct-transfer,decode-transfer,verify-transfer}.ts`
- corresponding unit/property tests
- `packages/schemas/src/envelope.ts`, exports and envelope hash vectors/tests
- package lock / root workspace config as required

#### P2-02A - Add additive envelope v2 + hash dispatch

- Keep v1 schema/hash functions/vectors working exactly.
- Add envelope v2 `schemaVersion: "2.0"` + hash preimage `v2`.
- Bind resolved nonce, type, max priority fee, existing max fee/gas/value/calldata/chain/etc., `accessList: []`, simulation block number/hash and existing authorization bindings.
- Tests: v1 golden regressions; v1/v2 domain separation; unknown fields; missing/new fields; non-empty access list; unsupported transaction type/family fields; unsafe integer/hex/address forms; deterministic v2 hash vectors.

#### P2-02B - Construct transfer core

- Use trusted wallet/token/chain/fixture identity + canonical intent.
- Use `viem.encodeFunctionData` only for `transfer(address,uint256)`.
- Set exact target/value/calldata and nonce **strategy**, but do not invent resolved nonce/gas/fee values that belong to P2-03.
- Ignore symbol/decimals hints as authority.

#### P2-02C - Independent strict decoder

- Manual exact 68-byte parse; no `viem` ABI decode import.
- Mutation corpus: selector, length, trailing bytes, padding, malformed hex, recipient, amount, opaque calldata.

#### P2-02D - Verify transfer core

- Compare chain, sender, token target, selector/action, recipient, amount, exact calldata, native value, nonce strategy and operation/intent/policy provenance available at this stage.
- Return typed mismatch reasons; never coerce/normalize mismatches into success.
- Dynamic type-2 fields are verified after P2-03 resolution before envelope finalization.

**P2-02 non-goals:** live simulation, gas estimation, signing, broadcast, generic ABI/arbitrary calls.

### P2-03 - Canonical simulation, executable-candidate resolution and native-fee enforcement

**Objective:** resolve the exact type-2 EVM transaction under canonical local state, prove token/gas authority separation, and produce simulation evidence suitable for envelope v2.

**Dependencies:** P2-02.

**Likely files:** `packages/simulation/...`, transaction-pipeline exact verification extension, chain simulation tests.

#### P2-03A - Pin simulation context

- Verify current fixture instance and `eth_chainId`.
- Capture canonical block number/hash, pending sender nonce, token/native balances.
- Execute exact transfer call against the selected canonical block and normalize revert evidence.
- Bind evidence to `fixtureInstanceId`.

#### P2-03B - Resolve gas and type-2 fees

- Estimate exact-call gas; apply one documented bounded margin.
- Estimate/select explicit `maxPriorityFeePerGas` and `maxFeePerGas`; set `transactionType: "eip1559"`, resolved nonce and `accessList: []`.
- Enforce `priority <= maxFee` and `gasLimit * maxFee <= min(intent ceiling, policy ceiling)` with checked integer arithmetic.
- Verify native balance covers maximum authorized cost. Never touch ERC-20 reservation amount.

#### P2-03C - Final exact candidate verification + freshness

- Verify all resolved type-2 fields against transfer core, simulation and constraints.
- Hash normalized simulation evidence.
- Pre-sign freshness API checks fixture instance, canonicality, configured block age, nonce, required balances and fee ceiling.
- Required test: mining an unrelated new head inside the freshness window does **not** invalidate an otherwise canonical simulation.
- Required stale tests: noncanonical/missing block, age exceeded, nonce consumption, token/native drain, fee ceiling breach/base-fee conflict, fixture reset/redeploy, executable field mutation.

**P2-03 non-goals:** external risk providers, external RPC, native rolling budget, simulation-as-authorization.

### P2-04 - Persistence, restricted local signer and adapter boundary

**Objective:** persist exact execution evidence and sign only current canonical authority in a separate local process.

**Dependencies:** P2-03 contracts stable.

#### P2-04A - Add forward execution-evidence migration

- Implement section 5 with version-dispatched v1/v2 DB envelope validation.
- Add local fixture instance, simulation, signed transaction, broadcast attempt and chain-evidence storage/constraints.
- Preserve all v1 DB/hash vectors and migrations 0001-0021.
- Test immutability, cross-operation binding, duplicate hashes, invalid v2/access-list/fixture data and migration checksum/forward application.

#### P2-04B - Provider-neutral capability contract + local reference shape

- Adapter SDK owns truthful capabilities/enforcement grades, normalized recovery/status contracts and provider-neutral authorized-execution semantics.
- The **local-Anvil implementation** exposes the IDs-only `signAuthorizedTransfer` operation.
- Do not encode "every adapter reads Crip PostgreSQL" into the universal SDK contract.
- Forbidden capabilities/methods are absent and fail closed.

#### P2-04C - Implement isolated local signer

- No key in argv/env/log/API/audit. Verify expected sender.
- Accept IDs only; authenticate component where required; load current envelope/authorization/reservation/fixture from trusted state.
- Re-run canonical authorization/fence/expiry/fixture/simulation/nonce/balance/fee checks immediately before signing.
- Sign exactly envelope-v2 type-2 fields including `accessList: []`.
- Derive expected transaction hash, persist signed evidence, retain raw bytes only inside the signer/broadcast boundary.
- Adversarial tests: caller raw fields, wrong key/address/chain/fixture, stale fence/approval/nonce/simulation/fee, malformed v2, v1 presented for signing, revoked component, logs/errors, crash before/after durable signed evidence.

**P2-04 non-goals:** production HSM/MPC/TEE, external provider adapter, network-exposed signer, owner MetaMask.

### P2-05 - Broadcast, confirmation and exact reconciliation

**Objective:** cross the ambiguous RPC boundary safely and turn only authenticated verification of matching chain evidence into one economic result.

**Dependencies:** P2-04.

#### P2-05A - Persist-before-send broadcast

- Persist expected hash and STARTED attempt before send.
- Matching returned hash -> ACCEPTED/BROADCAST.
- Explicit proven pre-acceptance rejection -> REJECTED candidate.
- Timeout/transport loss/no response/wrong hash -> UNKNOWN or CONFLICT; never definitive failure.
- Never reconstruct/re-sign on uncertainty.

#### P2-05B - Independently match untrusted chain evidence

- Poll by expected hash with bounded retry.
- Fetch transaction, receipt, canonical block and logs; raw transaction only where safe/useful.
- Verify current fixture instance, chain, hash, from/to/input/value/nonce/type/gas/max-priority/max-fee/access-list semantics, receipt status/block and exactly expected `Transfer` evidence.
- One canonical included block is sufficient only for local Anvil S2.
- Wrong/missing/incomplete evidence disputes; a receipt is not authority by itself.

#### P2-05C - Reconcile through ADR-0014 + existing ledger recovery

- Normalize verified chain result.
- Authenticate RECONCILER action using active ADR-0014 component credential and domain-separated payload.
- Acquire/verify recovery lease and call existing exactly-once resolution.
- Successful exact transfer -> CONFIRMED/finalized token spend once.
- Verified status-0 revert -> zero token spend + safe release under explicit recovery outcome; native fee remains separate evidence.
- Ambiguity/mismatch/conflict -> DISPUTED and retain reservation.
- Tests: evidence A for operation B; fixture mismatch; duplicate/concurrent attempts; stale lease; amount mismatch; valid versus forged reconciler claims; confirmed, reverted, and uncertain outcomes.

#### P2-05D - Prove clean vertical slice

From a seeded canonical intent, execute the complete autonomous-within-policy journey without directly seeding protected lifecycle states. Assert token balances, native fee evidence, lifecycle, reservation, v2 envelope, authorization, signed hash, broadcast attempt, transaction/receipt/log matching, recovery and audit correlation.

### P2-06 - Deterministic faults, adversarial proof and S2 closeout

**Objective:** prove ambiguity safety under deterministic failures; no sleep-race tests.

**Dependencies:** P2-05.

#### P2-06A - Method-aware local RPC fault proxy

Never proxy non-loopback destinations. Deterministic barriers for: unavailable before send, explicit rejection, forward-then-drop response, wrong hash/transaction/receipt, delayed receipt, and crash hooks around durable attempt boundaries.

#### P2-06B - Broadcast/crash matrix

Cover RPC unavailable, rejection before acceptance, request transmitted/response lost, known hash/no receipt, duplicate broadcast, receipt revert, stale nonce, crash before send, crash after send, recovery retry after uncertainty.

Every case asserts operation state, attempt classification, reservation state and allowed retry action. UNKNOWN never releases or re-signs.

#### P2-06C - Substitution/reconciliation matrix

Cover wrong transaction hash/from/to/recipient/amount/calldata/value/nonce/type/gas/fee/access list/chain/fixture/block/log; stale simulation; insufficient gas balance; fee escalation; duplicate/concurrent reconciliation; alternate signing attempts.

Property-mutate every envelope-v2 executable field and require fail-closed behavior.

#### P2-06D - S2 evidence closeout

Run fresh current-head clean-room gate; record exact test counts/run IDs; dependency/security/secret review; update living docs. Do not claim Phase-3 integrated owner-approval/revocation/broadcast-unknown proof.

Expected gate shape:

```bash
npm ci
npm run check
npm audit --audit-level=high
npm run dev:up
npm run dev:status
npm run contracts:test
npm run fixture:phase2
npm run test:db
npm run test:concurrency
npm run test:invariants
npm run test:chain
npm run test:fault
npm run test:adversarial
npm run dev:down
```

Every command must be real (no no-op pass) and protected current-head CI + Secret Scan must pass before S2 acceptance.

---

## 9. Dependency graph

```text
ADR-0015 ACCEPTED
        |
        v
P2-01 (implementation/review)
        |
        v
P2-02 -> P2-03 -> P2-04 -> P2-05 -> P2-06
```

- ADR-0015 acceptance is complete.
- P2-02 through P2-05 are sequential because they share exact envelope/evidence/security state.
- P2-06 fault-proxy infrastructure precedes fault/adversarial suites; independent suites may run in parallel only with isolated DB/Anvil fixtures.
- Do not begin a packet that consumes a prior contract until the prior packet is reviewed/stable.

---

## 10. Implementation-oriented test matrix

| Requirement | Test | Suite | Packet | Expected evidence |
| --- | --- | --- | --- | --- |
| inherited S0/S1 | complete existing gates | repo/unit/DB/concurrency/invariant | every packet | no accepted regression |
| local chain only | public host/wrong chain/runtime guard | repo + chain | P2-01/03/04 | refuse before deploy/RPC/sign |
| unique local execution epoch | reset/redeploy fixture instance | chain/repository | P2-01 | new `fixtureInstanceId`; old fixture stale |
| deterministic fake token | Forge behavior + deployment/code hash/balance | Forge + chain | P2-01 | fixed artifact, verified fixture |
| v1 compatibility | frozen v1 parse/hash/DB vectors | unit + DB | P2-02/04 | exact Phase-1 vectors unchanged |
| v2 domain separation | schema 2.0/hash v2 vectors | unit + DB | P2-02/04 | v1/v2 cannot collide by version semantics |
| access-list/type binding | non-empty/other-family mutations | unit/property | P2-02/06 | fail closed |
| exact construction | known transfer calldata vectors | unit | P2-02 | selector/address/uint256 bytes |
| independent verification | malformed/per-field mutation | unit/property | P2-02 | only exact static transfer core passes |
| mandatory simulation | success/revert/insufficient token | chain | P2-03 | canonical block + fixture-bound evidence |
| bounded freshness | unrelated head vs stale/noncanonical/state mutation | chain | P2-03/06 | unrelated fresh head stays valid; real stale inputs revalidate |
| native fee separation | insufficient native/ceiling/drift | unit + chain + invariant | P2-03 | token ledger unchanged by fee |
| immutable authorization | v2 DB hash/revision/fence guards | DB | P2-04 | stale/mutated v2 rejected |
| signer isolation | forbidden API/key/log tests | unit + chain | P2-04 | local IDs-only API; no secret/raw-byte output |
| wrong-chain/fixture sign | context mismatch | chain/adversarial | P2-04/06 | refusal before signature |
| persist-before-send | crash/drop at send boundary | DB + fault | P2-05/06 | expected hash + STARTED attempt durable first |
| response-loss ambiguity | forward/drop response | fault | P2-05/06 | UNKNOWN/DISPUTED; reservation retained |
| duplicate broadcast | repeat same bytes | fault | P2-06 | same hash, no duplicate economic effect |
| chain evidence matching | wrong tx/receipt/log/fixture variants | unit + fault | P2-05/06 | mismatch disputes |
| authenticated reconciliation | forged/valid reconciler claims | DB + chain | P2-05 | only ADR-0014 authenticated matching claim resolves |
| confirmed reconciliation | exact success | DB + E2E | P2-05 | finalized token spend once |
| verified revert | matching status-0 tx | chain + DB | P2-05 | zero token spend; safe evidence-driven release |
| duplicate/concurrent reconciliation | repeated/simultaneous claims | DB + concurrency | P2-05/06 | one economic winner; invariant preserved |
| complete audit | correlated lifecycle | E2E | P2-05/06 | all IDs/hashes, no prohibited data |

---

## 11. Threat ownership review

| Threat | Prevention | Required evidence | Owner |
| --- | --- | --- | --- |
| constructor self-verification | `viem` encoder + no-ABI strict parser | malformed/differential mutations | P2-02 |
| unbound signed fields | v2 `2.0` + v2 hash + all type-2 fields + `accessList: []` | v1/v2/mutation/signing tests | P2-02/04 |
| signer API abuse/key leak | separate local process, IDs-only API, redaction | forbidden-method/output/key tests | P2-04 |
| provider coupling | local DB signer explicitly reference-only | SDK/type/API review | P2-04 |
| wrong chain/local reset | checkout/chain/code + unique fixture instance | reset/wrong-fixture tests | P2-01/03/04/05 |
| stale simulation/nonce | canonical bounded freshness + exact pre-sign recheck | unrelated-head + stale-state barriers | P2-03/04 |
| fee manipulation | exact type-2 fee fields + max-cost checks twice | boundary/escalation tests | P2-03/04 |
| duplicate/response-loss broadcast | expected hash + durable STARTED attempt | forward/drop/crash/duplicate tests | P2-05/06 |
| false failure releases funds | only authenticated authoritative failure may release | response-loss/unknown tests | P2-05/06 |
| receipt/cross-operation substitution | full tx/receipt/log/fixture binding + ADR-0014 auth | operation-A-for-B + forged reconciler tests | P2-05/06 |
| RPC compromise | treat all RPC material as evidence, fail on inconsistency | malformed/mismatch proxy | P2-03/05/06 |
| alternate authorization path | signer reloads canonical evidence + DB guards | direct API/state abuse | P2-04 |
| secret logging | allowlist logging; no key/raw bytes | stdout/stderr/audit scans | P2-04/06 |
| public/testnet/mainnet escape | local runtime loader + chain/host refusal | wrong URL/chain tests | every packet |

Residual MVP risk: a fully compromised local host/signer can defeat local fake-value controls; one local RPC is not Byzantine independent; one Anvil inclusion is not production finality. These are explicit non-claims, not hidden assurances.

---

## 12. S2 closeout checklist

- [x] ADR-0015 accepted and governing docs aligned; accepted ADRs are not edited in place to change prior meaning.
- [ ] P2-01 reviewed: pinned local contract toolchain + fake token + unique fixture instance + reset/public-chain guards.
- [ ] Fresh clone/current head installs with lockfile and zero high vulnerabilities.
- [ ] Existing S0/S1 repository, unit, DB, concurrency, invariant and security gates pass unchanged.
- [ ] Anvil is loopback-only 31337 and current fixture instance/code hash is verified after clean reset.
- [ ] Envelope v1 frozen vectors remain exact; envelope v2 schema/hash vectors are deterministic and domain-separated.
- [ ] Constructor and independent decoder use separate implementations; all static mutation vectors fail closed.
- [ ] Simulation is fixture/block/nonce/balance/fee bound; unrelated fresh head does not cause a liveness loop; genuinely stale evidence cannot sign.
- [ ] Every unsigned type-2 field, including `accessList: []`, is envelope-bound and signer-exact.
- [ ] Native max fee is enforced before envelope and pre-sign and never touches ERC-20 budget accounting.
- [ ] Local signer accepts IDs only; no raw/message/typed signing surface; no secret/raw signed bytes in API/log/audit/fixture.
- [ ] Expected transaction hash + STARTED attempt are durable before send; response loss remains uncertain.
- [ ] Transaction, receipt, canonical block, fixture and exact `Transfer` evidence match envelope/operation/reservation.
- [ ] ADR-0014 authenticated reconciler evidence gates exactly-once economic resolution.
- [ ] Success finalizes once; verified status-0/pre-broadcast failure resolves safely; ambiguity/mismatch disputes and retains.
- [ ] All required deterministic fault/adversarial cases pass without sleep races.
- [ ] Complete correlated append-only audit timeline exists and contains no prohibited data.
- [ ] Protected current-head CI and Secret Scan pass and exact evidence IDs/counts are recorded in `docs/TEST_MATRIX.md`.
- [ ] Independent reviewer confirms no public/testnet/mainnet/real-fund/production-custody path and no Phase-3 overclaim.

---

## 13. Open questions

### Blocking architecture questions

At the pre-implementation checkpoint, P2-05D exposed two non-regression architecture gaps: `ALLOW_AUTONOMOUS` had no canonical non-approval authorization writer, and signer-local serialized bytes had no production composition into the accepted broadcaster. Product-owner decisions accepted ADR-0016 and ADR-0017; the implementation-ready package in `docs/plans/2026-08-31-p2-05d-architecture-gap-closure.md` is retained as historical context. ADR-0015 remains accepted and is not rewritten.

### Packet-owned non-blocking decisions

- P2-02 selected and locked `viem` `2.56.0`; `npm audit --audit-level=high` reports 0 vulnerabilities on the local integration head. Protected current-head evidence is not claimed.
- P2-03 selects and documents the smallest deterministic gas-limit margin and maximum simulation block age through explicit tests; both remain bounded by the accepted fee/freshness rules.
- P2-04 may choose child-process stdio or a mode-0600 Unix socket for the local signer after platform/reliability tests. Either way the local API remains IDs-only and non-network/public; the universal provider adapter contract remains provider-neutral.

---

## 14. Current handoff

### P2-05D architecture gap proposal (historical)

At reviewed checkpoint `2f78b0f3c888ca6b8b06340b8c4a308d1bb7053f`, P2-05A/B/C remained reviewed and accepted. This proposal was resolved by the product-owner decisions and implementation recorded below; it is retained as historical context.

### P2-05D implementation checkpoint

The clean vertical slice is implemented at remediation code SHA
`a45c32d46330230614c8a72b44c0941dd0cf1850` on `integration/p2-05d`.
It uses production preparation writers for lifecycle, simulation, policy and
envelope persistence, production `authorizeAutonomous`, the restricted
same-child signer/broadcaster composition, independent chain-evidence
verification, and ADR-0014 authenticated reconciliation. The fresh E2E passes
1/1 with no direct protected-state seeding. Exact local identities, economics,
leakage results and test counts are recorded in `docs/TEST_MATRIX.md`.
Protected CI `33365440241` and Secret Scan `33365440250` pass on
`f5d433b97c19d028bcde99741976cb4debb77d03`; the final documentation handoff
SHA is reported separately. S2 is not claimed.

### P2-05A/B/C integration checkpoint (historical)

The recovery integration branch is `integration/p2-05`. Its pre-documentation code head is `c0c4949590fbd7992f06537dc3cb93dd841a7936`, descended from P2-04C `0e00f212711c07aae363c28245d2ee453f8d84c2`. It integrates P2-05A persist-before-send broadcast, P2-05B independent untrusted chain-evidence verification, and the preserved P2-05C authenticated reconciliation path. Protected CI `33299665297` and Secret Scan `33299665282` both passed on that exact code head.

Local evidence at this historical checkpoint included `npm run check` (21 repository + 287 Vitest), audit with 0 high vulnerabilities, Forge 10/10, DB 82/82, concurrency 18/18, invariants 7/7, chain 10/10, envelope 68/68, transaction-pipeline 61/61, signer/adapter 36/36, broadcast 7/7, and reconciliation 10/10. The separate P2-06A compatibility branch passed its fault gate 59/59. The current P2-05D implementation evidence is recorded in the checkpoint above; P2-06B/C/D have not started; S2 remains **OPEN / NOT PASSED**.

### P2-05 external-review remediation (historical)

External review `5060378379` identified broadcast and reconciliation safety gaps at reviewed head `9dd981b1f3eee0289e441d0ce22a52f89d868dd6`. The remediation keeps ADR-0015 and the Phase-1 budget authority unchanged: exact canonical signed bytes are hashed before send; valid wrong returned hashes are CONFLICT; durable send-capable attempts fence pre-broadcast release; legacy evidence is DB-bound to the exact attempt/hash/nonce/receipt identity; and P2-05C retries serialize per operation and resume idempotently after economic resolution or effect persistence. This is historical remediation context; the current P2-05D evidence is recorded above and protected current-head evidence remains required for external review. S2 remains **OPEN / NOT PASSED**.

### P2-02 implementation/integration handoff

P2-02 integration used the reviewed commits `9a5fe377` (envelope v2) and `bc5ff828` (static transfer core) on stable P2-01 head `343de49`, producing local integration head `9d58f47`. It added no migrations, signer, broadcast or public-network behavior. Local combined evidence is recorded in `docs/TEST_MATRIX.md`; protected current-head CI and Secret Scan remain an external gate.

Review P2-01 specifically for:

- use of the existing digest-pinned Foundry image and explicit Solc version;
- minimal fake-token surface and deterministic Forge tests;
- no private key in argv/env/log/repo/fixture; prefer unlocked local-Anvil deployment for the fixture where the pinned tooling supports it;
- strict checkout/loopback/31337 guards;
- mode-0600 generated state;
- **new unique `fixtureInstanceId` on every fresh fixture deployment/reset**, even when deterministic EVM identifiers repeat;
- secret scans and S0/S1 regression gates;
- no P2-02 scope creep.

P2-03 input is the strict `TransferCoreCandidate` from `constructTransferCore`, the independently decoded `DecodedTransfer` from `decodeTransferIndependent`, the canonical transfer intent, and trusted local context/provenance. P2-03 is implemented locally in `packages/transaction-pipeline` with additive runtime schemas in `packages/schemas`: it pins simulation to the current loopback fixture and canonical block, resolves pending nonce/gas/type-2 fees/access-list, enforces checked native max-cost and balance separation, hashes normalized evidence, verifies exact fields, and exposes bounded freshness. It has no persistent candidate authority and performs no authorization/signing/broadcast. Local focused evidence is 20 unit tests and 1 chain test; protected current-head evidence is not claimed. Gate S2 remains **NOT PASSED** until the complete packet chain and closeout evidence pass.
