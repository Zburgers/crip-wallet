# P2-05D Architecture Gap Closure Implementation Plan

**Status:** Proposed — awaiting product-owner decision

**Baseline:** `2f78b0f3c888ca6b8b06340b8c4a308d1bb7053f`

**Scope:** local Anvil `31337`, loopback, disposable accounts, fake 6-decimal ERC-20 only. This plan contains no implementation evidence and does not complete P2-05D or Gate S2.

## Verified problem statement

### Gap A: no autonomous authorization writer

- `packages/policy-engine/src/index.ts` legitimately emits `ALLOW_AUTONOMOUS`.
- `packages/approvals/src/core.ts` rejects authorization unless `policy_decision_status === "REQUIRE_APPROVAL"` and consumes an approved owner request.
- `migrations/0015_wp03_approval_authorization.sql` makes `authorization_evidence.approval_id` and `approver_id` mandatory and its binding trigger requires approved/consumed approval evidence.
- `authorization_invalidations`, `signed_transactions`, `broadcast_attempts`, normalized chain evidence, and economic effects all converge on `authorization_evidence`; bypass insertion or a parallel unbound authority would be unsafe.

### Gap B: no signer-local signed-byte handoff

- `adapters/local-anvil/src/signer-keys.ts` signs the exact type-2 transaction and derives the hash but returns no serialized bytes.
- `adapters/local-anvil/src/signer-client.ts` exposes only safe metadata over parent IPC.
- `adapters/local-anvil/src/broadcast-core.ts` correctly requires exact raw bytes to canonical-roundtrip, derive/compare the durable hash, commit `STARTED`, and then send.
- No production function composes these contracts, so the clean P2-05D path cannot reach Anvil without violating ADR-0015.

## Decision matrices

### Autonomous authorization

| Option | Security | Migration risk | Compatibility | Complexity | Recommendation |
| --- | --- | --- | --- | --- | --- |
| A. Explicit kind in `authorization_evidence` | High: one root, XOR evidence, shared invalidation | Medium: conditional nullability and trigger dispatch | High: preserves IDs/FKs and owner rows | Medium | **Choose** |
| B. Separate autonomous table | Medium: cross-root races and guards | Medium | Low: downstream FKs/queries assume one table | High | Reject |
| C. Generic parent plus typed children | High | High: broad trigger/FK migration | Medium-high | High | Defer beyond MVP |

### Signed-byte handoff

| Option | Security | Migration risk | Compatibility | Complexity | Recommendation |
| --- | --- | --- | --- | --- | --- |
| A. Sign and broadcast in restricted child | High: bytes stay volatile/signer-local | Low | High: reuses broadcaster and safe IPC | Medium | **Choose** |
| B. Private FD/socket to broadcaster child | High if perfectly implemented | Low DB / high process risk | Medium | High | Reject for local MVP |
| C. Parent receives raw bytes | Low: violates signer-local boundary | Low DB | Low security compatibility | Low | Reject |

## Recommended trusted-data flows

### Autonomous authority

```text
IDs-only authorizeAutonomous request
        |
        v
transaction + canonical lock order
        |
        +--> immutable policy decision == ALLOW_AUTONOMOUS
        +--> current operation/reservation/latest envelope
        +--> policy/version/credentials/expiry
        +--> SYSTEM -> OWNER -> AGENT -> POLICY fences
        |
        v
authorization_evidence(kind=AUTONOMOUS_POLICY)
        +--> lifecycle transition writers
        +--> correlated safe audit
        |
        v
shared invalidation + signer revalidation boundary
```

### Signer-local execution

```text
parent IDs only
  operationId + authorizationId + adapterRequestId
        |
        v
isolated local-Anvil execution child
  trusted reload -> full pre-sign revalidation
        |
        v
exact viem type-2 signing (bytes in memory only)
  -> durable signed evidence + expected hash
        |
        v
accepted P2-05A broadcaster
  canonical roundtrip/hash equality
  reservation FOR UPDATE -> STARTED COMMIT
  -> eth_sendRawTransaction(exact bytes)
  -> ACCEPTED / UNKNOWN / CONFLICT / REJECTED
        |
        v
safe IDs/hash/status response only
```

## Persistence changes

Forward migration `migrations/0024_canonical_autonomous_authorization.sql`:

1. Add `authorization_kind` constrained to `OWNER_APPROVAL | AUTONOMOUS_POLICY`.
2. Classify every existing row as `OWNER_APPROVAL`; preserve IDs and all foreign keys.
3. Make only approval-specific fields conditionally nullable and add a strict XOR shape check. Owner rows retain every existing non-null/approval-consumption requirement; autonomous rows require those fields to be null.
4. Replace the approval-only binding trigger with a kind-dispatching canonical authorization trigger. The owner branch retains the current checks; the autonomous branch requires persisted `ALLOW_AUTONOMOUS`, exact decision hash, policy/version, operation/reservation/envelope binding, current latest revision, expiry, and active fence snapshots.
5. Add/confirm unique one-authorization-per-operation/current-envelope constraints and exact-idempotency behavior.
6. Generalize control/invalidation queries that currently join through `approval_requests`.
7. Do not add raw-byte storage. Prefer a namespaced PostgreSQL advisory execution lock plus existing signed/attempt uniqueness; add a DB constraint only if implementation analysis proves the current uniqueness insufficient.

No migration `0001` through `0023` is edited. Upgrade tests preserve their checksums.

## Public and private APIs

```ts
export type AuthorizeAutonomousInput = Readonly<{
  authorizationId: string;
  operationId: string;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: `0x${string}`;
  policyDecisionId: string;
  policyDecisionHash: `0x${string}`;
  idempotencyKey: string;
}>;

export async function authorizeAutonomous(
  pool: Pool,
  input: AuthorizeAutonomousInput,
  audit: AuditContext,
): Promise<CanonicalAuthorization>;
```

Inputs are references and claimed hashes used only for equality checks against trusted rows. The writer derives kind, policy status/version, fences, expiry, and every executable binding from PostgreSQL. It accepts no transaction fields.

```ts
// Adapter-private request; same narrow authority surface as current signer.
export type ExecuteAuthorizedTransferRequest = Readonly<{
  operationId: string;
  authorizationId: string;
  adapterRequestId: string;
}>;

export type ExecuteAuthorizedTransferResult = Readonly<{
  operationId: string;
  authorizationId: string;
  signedTransactionId: string;
  expectedTransactionHash: `0x${string}`;
  broadcastAttemptId: string;
  broadcastStatus: "ACCEPTED" | "UNKNOWN" | "CONFLICT" | "REJECTED";
  fromDurableEvidence: boolean;
  rematerializedBeforeSend: boolean;
  componentAuthorization: SafeComponentAuthorization;
  phaseNotices: readonly SafePhaseNotice[];
}>;
```

This operation is local-Anvil adapter-private. Provider-neutral SDK contracts continue to describe capabilities and IDs-only authorized execution; they do not require direct PostgreSQL access or this process topology. No public shape contains raw bytes, keys, calldata, nonce, gas, or fees.

## Crash and retry state table

| Durable signed evidence | Broadcast attempt | Allowed action |
| --- | --- | --- |
| no | none | Full revalidation and normal sign |
| yes | none | Under execution lock, full current revalidation; deterministically rematerialize exact v2 bytes; require durable hash equality; proceed to STARTED |
| yes | STARTED | No re-sign; recover by expected hash and ambiguity evidence |
| yes | ACCEPTED | No re-sign; monitor/confirm/reconcile |
| yes | UNKNOWN | No re-sign; expected-hash recovery only |
| yes | CONFLICT | No re-sign; dispute/recover only |
| yes | REJECTED | No automatic re-sign in PRE-B; separate retry-lineage approval required |

`viem` 2.56.0 plus locked `@noble/curves` uses exact serialization and deterministic secp256k1 signing for this path. PRE-B must freeze a signed-byte/hash regression vector. Any mismatch during rematerialization fails before `STARTED` and before RPC.

## Threat analysis

| Threat | Effect of proposal | Required control/evidence |
| --- | --- | --- |
| Caller asserts autonomous authority | Closed | Persisted decision status/hash only; DB trigger and writer reload |
| Approval fabrication/downgrade | Closed | Explicit kind and XOR shape; `REQUIRE_APPROVAL` stays owner-only |
| Dual authorization race | Closed | Shared locks, unique canonical authorization, cross-kind concurrency test |
| Stale policy/fence authorizes | Closed | Issuance locks plus full signer revalidation and invalidations |
| Parallel authority roots drift | Avoided | One authorization identity and invalidation namespace |
| Raw signed bytes leak to parent/log/DB | Closed | Same-child composition, allowlisted safe IPC, output/storage scans |
| Crash loses bytes before STARTED | Closed conditionally | Proven-pre-send deterministic rematerialization, current-state revalidation, hash gate |
| Retry re-signs after possible send | Closed | Any send-capable attempt prohibits rematerialization |
| Two executors cross sign/STARTED boundary | Closed | Per-operation execution lock through durable STARTED plus DB constraints |
| Serializer/signature upgrade breaks rematerialization | Introduced dependency risk | Locked versions, golden signed vector, explicit upgrade review |
| Child gains RPC capability | Narrowly increased TCB | Loopback/31337/fixture guards; accepted broadcaster only; no arbitrary API |

Residual limits remain unchanged: a compromised local signer host can defeat fake-value controls; one Anvil RPC is not Byzantine-independent; no public-network or production-custody safety is claimed.

## Test plan

### PRE-A focused suites

- Unit: `packages/approvals/test/autonomous-authorization.test.ts` for writer validation, exact binding, idempotency, and audit correlation.
- DB: `tests/db/autonomous-authorization.test.ts` for migration/trigger/direct-insert rejection and upgrade from `0023`.
- Concurrency: deterministic barriers for duplicate autonomous writers and owner/autonomous one-winner races; no sleeps.
- Signer regression: both authorization kinds pass the common guard; invalidated/stale autonomous evidence fails.
- Required adversarial cases: `REQUIRE_APPROVAL`, `DENY`, stale policy version/envelope revision, decision-hash/reservation mismatch, changed fence, system pause, owner/agent revocation, inactive policy, expiry, duplicate/concurrent authorization, forged insertion, pre-sign invalidation, and post-authorization policy change.

### PRE-B focused suites

- Unit/process: `adapters/local-anvil/test/execution-core.test.ts` for normal sign -> durable evidence -> STARTED -> send and safe response.
- Deterministic child barriers: before signed evidence; after signed evidence/before STARTED; after STARTED/before RPC; after RPC/before accepted response.
- Rematerialization: identical bytes/hash golden vector; mismatch, stale authorization, stale nonce, fixture reset, and current fence/policy change fail closed.
- State fencing: STARTED/ACCEPTED/UNKNOWN/CONFLICT prohibit rematerialization or re-sign.
- Leakage: scan stdout, stderr, phase notices, audit payloads, database text/JSON, fixture output, and errors for raw bytes and private key.
- API: excess-property/runtime-schema rejection for raw transaction fields, key, calldata, nonce, gas, and fee overrides.
- Re-run accepted signer and broadcaster suites unchanged.

### Integration and P2-05D retry

- Integration tests prove an autonomous authorization can drive the restricted child and accepted broadcaster without seeded protected state.
- Then retry the focused clean vertical slice on a fresh migrated DB and fresh Anvil fixture, followed by the full commands required by the P2-05D packet.
- P2-06 fault suites remain separate and unmerged.

## Implementation dependency graph

```text
P2-05A/B/C reviewed checkpoint
        |
        +-----------------------------+
        |                             |
        v                             v
P2-05D-PRE-A                  P2-05D-PRE-B
canonical autonomous auth     signer-local execution
        |                             |
        +-------------+---------------+
                      |
                      v
              serialized integration review
                      |
                      v
                 P2-05D retry
```

PRE-A and PRE-B may be implemented in parallel from the accepted checkpoint because their primary ownership is distinct: PRE-A owns authorization schema/writer/guards; PRE-B owns adapter-private execution/process composition and byte lifecycle. PRE-B must initially test against existing owner authorization. Integration is serialized: merge PRE-A first, adapt PRE-B's common authorization loader to both kinds, run combined security review, then retry P2-05D. Neither packet may redefine the other's tables or public contracts independently.

## Implementation work packets

### P2-05D-PRE-A — Canonical autonomous authorization

1. Add migration `0024_canonical_autonomous_authorization.sql` and exact `0023 -> 0024` upgrade tests.
2. Refactor approval-specific canonical guards into common authorization plus kind-specific evidence checks.
3. Implement IDs-only transactional `authorizeAutonomous` and correlated audit event.
4. Generalize invalidation/control/signer queries; retain owner behavior.
5. Run focused unit/DB/concurrency/adversarial and all Phase-1 gates.

### P2-05D-PRE-B — Signer-local execution

1. Refactor internal signer result so serialized bytes remain accessible only within the child call stack.
2. Add adapter-private execution handler and safe IPC schemas.
3. Compose the existing broadcaster, add execution serialization, and implement proven-pre-send rematerialization.
4. Add deterministic crash barriers, locked signed-vector, state-fence, and leakage tests.
5. Run existing signer/broadcast/P2-05A suites unchanged.

### Integration review

1. Rebase/merge both approved packets in dependency order without P2-06A.
2. Verify common authorization projection, migrations, lock ordering, lifecycle/audit correlation, and no alternate send path.
3. Perform focused security review and full repository gates.

### P2-05D retry

Implement only the clean E2E composition/test and proposal-approved documentation status changes. Seed legitimate fixture/reference data only; all protected lifecycle/evidence must come from production writers.

## Files expected to change

PRE-A:

- `migrations/0024_canonical_autonomous_authorization.sql`
- migration manifest/checksum files used by the repository
- `packages/approvals/src/core.ts`, `packages/approvals/src/control.ts`, exports/types
- signer store/common authorization loader where approval joins are assumed
- `packages/audit` event schemas if the new safe event requires registration
- focused approval, DB, concurrency, migration, and signer tests

PRE-B:

- `adapters/local-anvil/src/signer-core.ts`, `signer-keys.ts`, `signer-child.ts`, `signer-client.ts`, IPC schemas/types
- a narrow `execution-core.ts`/child handler if composition cannot remain readable in existing modules
- `adapters/local-anvil/src/broadcast-core.ts` only for dependency injection/transactional composition needed to reuse it, not semantic redesign
- adapter execution, crash-barrier, redaction, signer, and broadcast tests

Integration/P2-05D:

- repository-consistent focused E2E test and optional `test:e2e` script
- `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, `docs/THREAT_MODEL.md`, `docs/RISK_REGISTER.md`, and `docs/TEST_MATRIX.md` with truthful evidence only

## Verification commands after implementation

Run each focused suite first, then `npm ci`, `npm run check`, `npm audit --audit-level=high`, `npm run dev:up`, `npm run dev:status`, `npm run contracts:test`, `npm run fixture:phase2`, `npm run test:db`, `npm run test:concurrency`, `npm run test:invariants`, `npm run test:chain`, the exact E2E command, and `npm run dev:down`. Protected CI and Secret Scan must test the exact pushed final SHA before P2-05D completion may be claimed.

## Product-owner decisions required

1. Approve or reject ADR-0016's explicit-kind generalization of `authorization_evidence`.
2. Approve or reject ADR-0017's signer-local sign-and-broadcast child and pre-STARTED deterministic rematerialization rule.
3. Confirm conservative no-automatic-retry behavior for an existing `REJECTED` attempt pending later fault/retry design.
