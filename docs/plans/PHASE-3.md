# Phase 3 Plan - WS-005 Integrated Approval Controls

Status: **IN PROGRESS — P3-01 THROUGH P3-04 CLEARED; P3-05 LOCAL MATRIX PASS (F18 RESERVED FOR P3-06); P3-06 CLEAN-ROOM / INDEPENDENT CLOSEOUT PENDING**

Planning branch: `phase-3/ws-005-integrated-controls`

Planning base: `main` at `769db481472aab60a07efdd4b2390058321402e4`

Governing architecture decision: ADR-0018, **ACCEPTED — 2026-09-17**.
P3-01 implementation may begin from the protected post-planning main.

## Objective

Connect the accepted S1 authorization/control model to the accepted S2 local
execution pipeline:

```text
construct -> verify -> simulate -> authorize -> sign -> broadcast
          -> confirm -> reconcile
```

The Phase-3 proof must establish one coherent authority-to-economic-finality
model across owner approval, autonomous authorization, pause, revocation,
signed-unbroadcast handling, broadcast uncertainty, recovery takeover, and
exactly-once reconciliation.

## Non-goals and safety boundary

- No public RPC, testnet, mainnet, real funds, real wallet, production custody,
  production identity, browser/session implementation, or provider adapter.
- No arbitrary calldata or generic signing API, `personal_sign`, typed-data
  signing, permit, unlimited approval, repricing, replacement transaction, or
  automatic retry after a broadcast attempt.
- No new lifecycle enum, global epoch service, workflow engine, queue, or
  dependency unless implementation proves an existing primitive cannot satisfy
  an accepted invariant.
- No claim that pause or revocation can cancel a transaction after send commit.
- No S3/testnet-readiness or final-MVP acceptance claim.

All acceptance evidence is local-only: loopback Anvil `eip155:31337`, the
repository fake ERC-20, disposable local credentials, and the existing local
reference adapter.

## Governing authority and entry assumptions

Read in this order before implementation:

1. `docs/PRODUCT_SPEC.md`
2. `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/SECURITY.md`
3. ADR-0003, ADR-0005, ADR-0008, ADR-0011, ADR-0014, ADR-0015,
   ADR-0016, ADR-0017, and accepted ADR-0018
4. `docs/plans/MVP_MASTER_PLAN.md`, `docs/plans/PHASE-1.md`, and
   `docs/plans/PHASE-2.md`
5. `docs/workstreams/WS-004-transaction-pipeline.md` and
   `docs/workstreams/WS-005-approval-controls.md`
6. `docs/TEST_MATRIX.md` and `docs/RISK_REGISTER.md`

Accepted entry assumptions:

- S1 is accepted: canonical authorization is one-time and envelope-bound;
  `SYSTEM`, `OWNER`, `AGENT`, and `POLICY` fences are authoritative and
  monotonic; control changes invalidate stale authority transactionally.
- S2 is accepted only for the local fake-money boundary: exact envelope v2,
  restricted local signer, safe signed evidence, durable `STARTED` before RPC,
  authenticated recovery evidence, and exactly-once economic effects.
- Raw signed bytes and private keys remain confined to volatile memory inside
  the isolated local execution child.
- RPC, receipts, logs, adapter responses, and process clocks are evidence, not
  authorization authority.
- Existing migrations are checksum-locked. P3-01 added
  `0026_ws005_integrated_control_boundary.sql`; because that packet has already
  been applied to the integration runtime, later packet schema changes use new
  forward-only migrations rather than changing its checksum. P3-02 adds
  `0027_ws005_signed_unbroadcast_control.sql` and follow-ups
  `0028_ws005_existing_attempt_recovery.sql` and
  `0029_ws005_rejected_attempt_recovery_guard.sql` and
  `0030_ws005_invalidated_rejected_release_guard.sql`. P3-03 adds
  `0031_ws005_started_authority_guard.sql` for fence-first send-start authority.

## P3-00 actual failure and race model

The current S1 and S2 components are individually accepted, but their shared
boundary has four material gaps:

1. The signer locks operation/authorization/reservation before control fences,
   while control writers lock fences first. That inversion permits a database
   deadlock instead of the required deterministic serialization.
2. `AUTHORIZED -> SIGNING` commits, local signing occurs, and signed evidence
   commits in separate transactions. A control change can therefore win while
   volatile bytes exist or leave durable half-signing state.
3. Control invalidation targets `AUTHORIZED`, not `SIGNED`, while the current
   `STARTED` writer checks the reservation but not the current authorization and
   fence tuple. Signed work can cross the broadcast boundary after control has
   changed.
4. After `STARTED`, current-fence requirements can block legitimate recovery
   and reconciliation. A later control change must not erase or strand a
   possibly-sent economic effect.

The following transitions are security-sensitive:

| Boundary/race | Authoritative fact | Required result |
| --- | --- | --- |
| Approval/autonomous authorization -> pre-sign | canonical `authorization_evidence`, decision, envelope, reservation, four fence versions | signer reloads and transactionally revalidates the exact tuple; initial process snapshots never authorize |
| Pause/revoke before signer fence locks | committed control fence/invalidation | signing fails; eligible unsigned held work may be released |
| Pause/revoke while bounded signing holds locks | lock winner and transaction commit order | control waits; signed evidence either commits atomically first or signing rolls back entirely |
| Envelope/policy/simulation/fee/nonce/fixture drift | immutable envelope plus current trusted facts | no signature; supersession requires fresh authority rather than mutation |
| Signer crash before signed-evidence commit | database transaction rollback | operation remains `AUTHORIZED`; no durable signature claim exists |
| Signed evidence, no attempt | `signed_transactions` row plus zero attempt rows | still cancellable only into quarantine: control makes `DISPUTED`, retains value, and forbids broadcast |
| Control before `STARTED` | current fence/invalidation wins | no `STARTED`; signed evidence remains quarantined until authenticated no-send recovery |
| `STARTED` before control | committed attempt wins | possibly sent; no cancellation/release/re-sign; monitor and reconcile |
| Crash after `STARTED`, before/during RPC | durable `STARTED` and expected hash | `UNKNOWN`/recovery semantics; never assume non-execution |
| Response loss | expected hash, nonce, attempt, authenticated chain evidence | remain held/disputed until exact evidence resolves outcome |
| Confirmation/revert/conflicting evidence | independently verified canonical evidence | finalize/release only through authenticated exactly-once recovery; conflict remains disputed |
| Recovery lease acquisition/loss | DB-time expiry and `lease_version` | stale worker cannot resolve after expiry, renewal, or takeover |
| Worker restart/takeover | immutable attempt identity plus current lease generation | resume the same attempt; never create new authority/signature/attempt |
| Concurrent pause/revoke/recovery | pre-send fence gate vs post-send immutable attempt gate | pause controls future authority; committed attempts remain recoverable |
| Duplicate execution/retry | DB unique constraints and deterministic IDs | return/continue the existing lineage or fail closed; never manufacture authority |

## Authoritative persisted state

| Question | Authority |
| --- | --- |
| What was requested? | `intents` and immutable operation binding |
| What policy allowed? | immutable `policy_decisions` and version/hash |
| What value is protected? | `budget_reservations` plus ledger balances/effects |
| What may execute? | exact `execution_envelopes` revision/hash |
| Who/what authorized it? | sole root `authorization_evidence`, owner or autonomous source evidence, and absence of `authorization_invalidations` |
| Was control current pre-send? | authorization's four `control_fences` versions compared under locks to current fence rows |
| What was signed? | one `signed_transactions` row bound to operation, authorization, envelope, fixture, and expected hash |
| Could it have been sent? | one `broadcast_attempts` row; `STARTED` or later is send-capable |
| What happened on chain? | independently verified transaction, receipt, block, and transfer-log evidence |
| Who may recover now? | authenticated component credential plus unexpired DB-time `operation_recovery_leases.lease_version` |
| Was value reconciled? | one `execution_economic_effects` row and balanced ledger mutation |

Audit rows are required correlated evidence, but never replace the state rows
that authorize a transition. Application memory, logs, RPC responses, worker
identity strings, and wall-clock time are not authoritative.

## Frozen architecture decision

ADR-0018 is the Phase-3 design boundary. Its decisions were frozen during
packet planning and are accepted before P3-01 implementation:

- Reuse the four control-fence versions plus immutable authorization ID as the
  authority epoch. Do not add another epoch table.
- Perform `AUTHORIZED -> SIGNING -> SIGNED` and bounded local cryptographic
  signing inside one fence-first database transaction. No RPC is allowed while
  those locks are held.
- Revalidate authority a second time immediately before the transaction that
  inserts `STARTED`.
- Treat the `STARTED` commit as the send-commit linearization point.
- Before `STARTED`, a control change quarantines signed evidence using existing
  `DISPUTED` states and retains value. After `STARTED`, control cannot cancel,
  release, re-sign, or block evidence-based reconciliation.
- Prove signed-unbroadcast non-send from database evidence that the sole
  broadcaster never inserted an attempt. Do not ask an RPC/mempool to prove a
  negative.
- Fence recovery workers with existing `lease_version`, checked using database
  time. Retries reuse exact evidence and cannot create new authority.

## Lifecycle and state-machine mapping

No new public lifecycle state is required.

| Starting state/evidence | Event | Required durable outcome |
| --- | --- | --- |
| `AUTHORIZED`, no signed row | current authority wins sign gate | atomic transition through `SIGNING` to `SIGNED` plus one signed row |
| `AUTHORIZED`, no signed row | control wins | `REVOKED` or existing Phase-1 invalidation/release outcome; no signature |
| `SIGNED`, no attempt | control wins | authorization invalidation; operation and reservation `DISPUTED`; signed evidence quarantined by state |
| `SIGNED`, no attempt | current authority wins send gate | one `STARTED` attempt commits; reservation remains protected pending send/recovery |
| `DISPUTED`, signed row, no attempt | authenticated proven-no-send recovery | release exactly once; record recovery/audit evidence; never reuse signature |
| any state with send-capable attempt | pause/revoke | invalidate future authority only; preserve attempt/reservation and continue recovery |
| `STARTED` | RPC accepts | attempt `ACCEPTED`; later verified chain evidence drives confirmation |
| `STARTED` | response lost/crash/unclear | attempt `UNKNOWN` or retained `STARTED`; held/disputed, expected-hash recovery only |
| `STARTED` | provable pre-acceptance rejection | `REJECTED`; no automatic re-sign or new attempt |
| `ACCEPTED`/`UNKNOWN` | canonical success evidence | `BROADCAST -> PENDING_CONFIRMATION -> CONFIRMED -> RECONCILED`; one effect |
| send-capable attempt | verified revert | `REVERTED -> RECONCILED`; token reservation released, native fee remains separate |
| send-capable attempt | substituted/conflicting evidence | `DISPUTED`; no economic release/finalization until exact evidence resolves it |

An attempt with `STARTED`, `ACCEPTED`, `UNKNOWN`, or `CONFLICT` is irrevocable
with respect to cancellation. `REJECTED` is not send-capable evidence but still
does not authorize a new signature or attempt in Phase 3.

Cancellation is therefore explicit: unsigned authorized work may be invalidated
and released; signed/no-attempt work may have its send permission cancelled but
its signature evidence and reservation remain until proven-no-send recovery;
and `STARTED` or later cannot be cancelled at all. Confirmation or verified
revert makes the observed economic outcome authoritative for exactly-once
reconciliation, regardless of later control changes.

## Trust boundaries

- Agent/public caller: IDs and validated provider-neutral requests only; never
  executable fields, raw bytes, private keys, or recovery authority.
- Authorization/control service: owns decisions, fence locks, invalidations,
  and audits; it does not claim post-send cancellation.
- PostgreSQL: durable source for authority, locks, evidence, uniqueness,
  recovery generations, and economic effects.
- Isolated local execution child: owns disposable key and volatile signed bytes;
  may perform bounded signing and loopback send only after database gates.
- Loopback Anvil: untrusted execution/evidence endpoint, not authority.
- Reconciler: may mutate value only with ADR-0014 credential evidence, exact
  attempt/hash binding, independently verified chain evidence, and live lease.

## Required implementation changes

### Signing boundary

- Replace the split `beginSigning()` / `persistSignedEvidence()` durable
  authority protocol with one adapter-private transaction callback, tentatively
  `signAndPersistUnderAuthority()`. It owns the transaction and invokes only the
  bounded in-process signer after every DB/live-fact check succeeds.
- Move signer row locking to the canonical order: four fences first, then
  authorization/decision, operation, reservation, envelope/simulation, and
  credential evidence.
- Sample live nonce, fee, balance, fixture, and canonical simulation facts
  immediately before the database transaction, carrying the canonical block,
  observation time, and accepted freshness deadline. Set a bounded lock timeout
  no later than the shortest authority/simulation/sample deadline. After locks
  are acquired and again before commit, compare database time to that deadline;
  if the chain advances under the deterministic barrier or any fact becomes
  stale, roll back, resample, and start over without signing.
- A crash, thrown signer error, hash mismatch, or persistence error rolls the
  entire transaction back. No durable `SIGNING` cleanup worker is added.

### Control service

- Classify affected operations by exact execution evidence, not operation state
  alone.
- Preserve current Phase-1 release for unsigned `AUTHORIZED` work.
- For signed/no-attempt work, insert the invalidation and atomically transition
  operation/reservation to `DISPUTED`; do not delete signed evidence.
- For any existing attempt, record the control change/invalidation for future
  authority but do not release or obstruct the committed attempt lineage.

### Broadcast boundary

- Expand `startBroadcastAttempt()` into the second fence-first transaction.
- Require the exact current authorization/fence/envelope/signed/credential
  tuple and no invalidation immediately before inserting `STARTED`.
- Commit `STARTED` before RPC exactly as Phase 2 does. After commit, never
  revalidate against current fences to decide whether recovery may continue.
- Make the restricted execution composition the sole raw-send gateway: remove
  or privatize exported raw-sender construction and the old sign-only entry
  point. Every raw send must load its exact already-committed `STARTED` row;
  agent-facing/provider-neutral code cannot obtain a sender.

### Recovery/reconciliation

- Change lease resolution to enforce unexpired ownership in SQL using
  `clock_timestamp()` and the expected `lease_version`.
- Teach authenticated recovery to release signed-unbroadcast `DISPUTED` work
  only after locking and proving: exact signed row, zero attempt rows, matching
  control invalidation, and live lease. The existing `FAILED` resolution may be
  reused with stricter evidence; no new outcome enum is required.
- Complete that no-send recovery atomically as: one idempotent `FAILED`
  `recovery_attempt` with reason code
  `SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT`, reservation
  `DISPUTED -> RELEASED`, operation `DISPUTED -> RECONCILED`, lease `RESOLVED`,
  and correlated release/state audits. Assert that no
  `execution_economic_effects` row exists because no chain effect occurred.
- For `STARTED` and later, bind recovery to immutable signed/attempt/hash facts,
  not current control fences. Preserve all ADR-0014 evidence requirements.
- Wire the local adapter status/recovery path to real local-chain evidence where
  Phase-3 acceptance exercises it; remove hard-coded unknown placeholders from
  the accepted path without widening the public interface.

## Database and migration impact

Forward-only migrations:

- `0026_ws005_integrated_control_boundary.sql` — P3-01 uniqueness backstops.
- `0027_ws005_signed_unbroadcast_control.sql` — P3-02 evidence-aware control
  invalidation and signed-work release fencing.
- `0028_ws005_existing_attempt_recovery.sql` — allow broadcast/finalization
  only through the exact immutable lineage of an already committed attempt,
  even after control changes.
- `0029_ws005_rejected_attempt_recovery_guard.sql` — prevent a proven no-send
  `REJECTED` attempt from re-entering broadcast/finalization after control.
- `0030_ws005_invalidated_rejected_release_guard.sql` — prevent direct release
  and expiry of a control-invalidated `REJECTED` attempt.
- `0031_ws005_started_authority_guard.sql` — apply the same fence-first
  authority locks and currentness checks to durable `STARTED` creation.

Required changes:

1. Add an unconditional unique constraint/index permitting at most one signed
   transaction per `(operation_id, authorization_id)`.
2. Replace the partial `STARTED` uniqueness backstop with unconditional at-most-
   one broadcast attempt per `signed_transaction_id`.
3. Update canonical reservation/authorization guards:
   - `AUTHORIZED` still requires current non-invalidated authorization and fence
     equality;
   - `BROADCAST` and `FINALIZED` require the exact immutable signed transaction
     and committed attempt/evidence lineage, not current fence equality.
4. Replace `enforce_authorization_invalidation_binding()` and its trigger with
   an evidence-aware state matrix while preserving exact control-event scope:
   - unsigned `AUTHORIZED`: existing `REVOKED`/`REVALIDATION_REQUIRED` plus
     `RELEASED` semantics;
   - signed/no-attempt: exact signed row, operation/reservation `DISPUTED`, and
     no release;
   - existing attempt: invalidation may block future authority but must preserve
     the attempt lineage and reservation.
5. Extend `fence_send_capable_attempt_release()` to cover
   `DISPUTED -> RELEASED/EXPIRED`. Any send-capable attempt blocks that
   transition; the signed-no-attempt release branch requires the exact signed
   row, zero attempts, matching invalidation, and active expected DB-time lease.
6. Add trigger/backstop checks required to prevent `STARTED` for invalidated or
   mismatched signed evidence. Application revalidation remains mandatory.
7. Reuse existing state, invalidation, audit, attempt, lease, and economic-effect
   tables. Do not persist raw bytes or private material.

Migration tests must start from a clean schema and from the immediate prior
schema, prove historical migrations unchanged, prove duplicate rejection, and
prove no accepted Phase-2 row becomes ambiguously reinterpreted. If existing
data can violate new uniqueness, the migration must fail closed with an
operator-readable precondition rather than choosing a winner.

## Interface impact

- Public/provider-neutral schemas remain IDs-only and backward compatible.
- The local adapter-internal signing store changes from two transaction methods
  to one bounded transaction-owned signing operation.
- The broadcast store accepts the exact authorization/control binding required
  for transactional revalidation; callers cannot supply executable overrides.
- Control results may report `DISPUTED` signed-unbroadcast quarantine and an
  immutable post-send monitoring obligation.
- Recovery/status responses must expose structured `PENDING`, `UNKNOWN`,
  `DISPUTED`, `CONFIRMED`, `REVERTED`, or reconciled facts without converting
  uncertainty into generic success/failure.
- No new user-facing signing, retry, cancellation, or raw-transaction API.

## Security invariants

1. Only current canonical authorization can cross either the sign gate or the
   send-commit gate.
2. Approval, policy, reservation, envelope, simulation, signer credential, and
   all four fence versions remain bound to one immutable authorization lineage.
3. No executable field can change after authorization without a new envelope
   and new authorization.
4. A control mutation committed before signed evidence prevents a durable
   signature; one committed after signing but before `STARTED` prevents send.
5. A `STARTED` commit is possibly sent and cannot be cancelled or released by
   pause/revocation.
6. Retries never create a second signature, attempt, authorization, nonce, fee
   choice, or economic effect.
7. A stale recovery worker cannot mutate state after lease expiry/takeover;
   the final SQL mutation requires `lease_state = 'ACTIVE'`, expected
   `lease_version`, and `lease_expires_at > clock_timestamp()`, and checks one
   affected row.
8. `UNKNOWN`, `CONFLICT`, incomplete, substituted, or unauthenticated evidence
   stays held/disputed.
9. Reconciliation remains exactly once and continues after post-send control
   changes using immutable attempt evidence.
10. Raw signed bytes, keys, and secrets never enter PostgreSQL, audit, logs,
    stdout/stderr, fixtures, IPC responses, or repository state.
11. Every committed security-sensitive transition and durable denial emits
    correlated, redacted audit evidence in the same transaction. An abrupt
    process/transaction rollback is proven by absence of the transition and
    redacted operational evidence; it cannot truthfully create a committed
    same-transaction audit row.
12. The executable network boundary remains loopback Anvil/fake assets only.
13. The absence of a broadcast attempt proves no send only because every raw-
    send path is private to the one execution gateway and requires `STARTED`.

## Concurrency and race semantics

Canonical lock order is mandatory in signer, control, broadcaster, and recovery
writers:

```text
SYSTEM fence -> OWNER fence -> AGENT fence -> POLICY fence
-> approval/autonomous decision -> authorization
-> operation -> reservation -> envelope/simulation
-> signed transaction -> broadcast attempt -> recovery lease/attempt
```

Only rows required by the transition are locked, but their relative order never
changes. Per-operation advisory locks remain a throughput/idempotency aid; row
locks and constraints are the security backstop. Tests must prove both possible
lock winners and assert the resulting rows, not rely on timing sleeps.

PostgreSQL consistent lock ordering is the deadlock prevention rule. Bounded
local cryptography may remain inside the signing transaction; RPC, confirmation
polling, and provider I/O may not.

Implementation reference: PostgreSQL 17
[Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)
governs row/advisory lock behavior and consistent ordering; PostgreSQL 17
[System Administration Functions](https://www.postgresql.org/docs/17/functions-admin.html)
governs transaction-scoped advisory locks. Repository tests and migrations,
not documentation assumptions, remain the acceptance evidence.

## Crash and recovery semantics

| Crash point | Resume rule |
| --- | --- |
| before sign transaction | retry from trusted reload |
| during signing transaction | PostgreSQL rollback; retry only after full revalidation |
| after signed commit, before send gate | retry may rematerialize exact bytes only after full current revalidation and durable-hash equality; a control invalidation instead quarantines it |
| during send-gate transaction | rollback means no attempt and no send; retry the exact gate |
| after `STARTED`, before RPC | possibly sent; no re-sign; recover exact hash/nonce |
| during RPC or before response persistence | `UNKNOWN` semantics; retain value and recover exact attempt |
| after chain evidence, before economic effect | authenticated leased recovery replays idempotently; unique effect prevents duplication |
| after lease loss/takeover | old worker fails its transactional DB-time/version check |

No worker infers failure from process death, timeout, missing response, local
clock, or the absence of a receipt at one observation.

## Audit and evidence requirements

Every packet must preserve a single trace through operation, intent, policy,
reservation, envelope, authorization, four fence versions, signed hash,
attempt, chain evidence, recovery lease/attempt, and economic effect.

Add/redact audit events for:

- sign-gate granted/denied and the exact safe authority/evidence IDs;
- signed evidence committed, plus explicit signer-failure/rollback evidence
  when the process remains available;
- signed-unbroadcast quarantine and its control event/invalidation;
- send gate granted/denied and `STARTED` commit;
- control-after-send monitoring obligation;
- recovery claim, stale-lease denial, proven-no-send release, ambiguity,
  confirmation/revert/conflict, and exactly-once reconciliation.

Audits include IDs, versions, hashes, reason codes, and safe lifecycle facts.
They exclude raw transactions, private keys, signatures that expose secret
material, database URLs, and credential tokens.

## Deterministic test strategy

Tests use explicit barriers/hooks around fence acquisition, signer invocation,
signed commit, send-gate acquisition, `STARTED` commit, RPC forwarding, response
persistence, evidence verification, and economic-effect insertion. Each race is
run with both winners. No acceptance test uses arbitrary sleeps as proof.

Planned focused files:

- `tests/concurrency/p3-control-execution-fence.test.ts`
- `tests/db/p3-integrated-controls.test.ts`
- `adapters/local-anvil/test/p3-sign-send-control.test.ts`
- `tests/fault/p3-control-recovery.test.ts`
- `tests/adversarial/p3-integrated-controls.test.ts`
- `tests/chain/p3-approval-controls-e2e.test.ts`

Names may change only to follow an existing adjacent suite pattern; the matrix
and scripts must be updated in the same packet.

## Fault and adversarial matrix

| ID | Injection | Required assertion | Owner |
| --- | --- | --- | --- |
| P3-F01 | pause/revoke before sign locks | zero signer call; invalidated/released unsigned work | P3-01 |
| P3-F02 | control waits behind sign locks | one signed row commits, then control quarantines before send | P3-01/02 |
| P3-F03 | signer throw/process crash | transaction rollback to `AUTHORIZED`; no signed row | P3-01 |
| P3-F04 | envelope/policy/fence/expiry/nonce/fee/fixture drift | no signature and no state advance | P3-01 |
| P3-F04A | chain advances or freshness expires while sign waits for a fence lock | bounded timeout/DB-time check rolls back; zero signer call | P3-01 |
| P3-F05 | pause/revoke after signed commit before send gate | `DISPUTED`, retained reservation, zero attempt/RPC | P3-02 |
| P3-F06 | duplicate control writers | monotonic fences; one effective invalidation/quarantine | P3-02/04 |
| P3-F07 | `STARTED` wins before control | no cancellation/release; recovery continues | P3-03 |
| P3-F08 | crash after `STARTED` before RPC | no re-sign/new attempt; exact-hash recovery | P3-03 |
| P3-F09 | RPC forward then response drop | `UNKNOWN` retention and eventual exact reconciliation | P3-03 |
| P3-F10 | replaced/substituted transaction/receipt/log | `DISPUTED`; zero economic effect | P3-03/05 |
| P3-F11 | recovery lease expires or is taken over at resolution | stale worker writes nothing | P3-04 |
| P3-F12 | concurrent recovery/control/retry | one attempt lineage and one economic effect | P3-04 |
| P3-F13 | signed-no-attempt recovery with forged/missing invalidation | no release | P3-04/05 |
| P3-F13A | signed-no-attempt proven recovery | one FAILED recovery attempt; `DISPUTED -> RECONCILED`; reservation released; zero economic-effect row | P3-04/05 |
| P3-F14 | duplicate signed row/attempt IDs or alternate IDs | DB constraint rejects; no second send | P3-01/03 |
| P3-F15 | post-send fence change hits reconciliation guard | exact committed attempt still reconciles once | P3-03/04 |
| P3-F16 | secret/raw-byte injection or output scan | rejected/redacted; no persistence/log leakage | P3-05 |
| P3-F17 | non-loopback/wrong chain/fixture reset | fail closed before sign/send/reconcile | P3-05 |
| P3-F18 | cleanup/restart/new checkout | no shared runtime contamination; evidence reproducible | P3-06 |
| P3-F19 | direct/raw sender or sign-only entry-point invocation | unavailable outside restricted gateway; zero send without matching `STARTED` | P3-03/05 |

## Work packets

### P3-01 - Pre-sign authority transaction and execution binding

Status: **IMPLEMENTED / MAX REVIEW PASS / EXACT-SHA CI + SECRET SCAN PASS** on
`404837db138ad1bd5c3aceaff6bae67652d5ed01` (runs `35485643373` and
`35485643343`). The atomic database boundary, bounded database-time deadline,
and selected R-033 chain-mutation lease are implemented. P3-02's dependency is
cleared.

Scope:

- ADR-0018 must be accepted before code changes.
- Add migration `0026` uniqueness and canonical-guard foundation.
- Normalize canonical lock order.
- Replace split signing transitions with the bounded atomic sign/evidence
  transaction.
- Preserve owner and autonomous authorization through the same common gate.

Acceptance:

- Both control-first and signer-first barriers are deterministic and deadlock-
  free.
- Drift in any bound identity/fact prevents signer invocation.
- Chain advancement/freshness expiry while waiting for locks rolls back before
  signer invocation under a bounded deadline.
- Signer failure/crash leaves `AUTHORIZED`, no signed row, and no secret output.
- Exactly one signed row exists for one operation/authorization.
- Existing Phase-1 approval/autonomous and Phase-2 signer suites remain green.

#### P3-01 R-033 resolution: checkout-scoped chain-mutation lease

The selected resolution enforces one exclusive lease across every supported
local Anvil writer. The gateway is the only RPC endpoint published to the host;
it binds on a dynamically assigned loopback port. Anvil has no published host
port and stays on the internal `anvil-private` network. The gateway is attached
to that network and a dedicated `gateway-host` bridge; PostgreSQL remains on
`local-only` and cannot reach the gateway over a shared container network.

The gateway rejects batches and methods outside explicit read/mutation
allowlists. It holds `.local/coordination/anvil.lock` across each state-changing
RPC and its atomic durable-state checkpoint. A checkpoint failure poisons the
gateway and blocks later calls. `dev-up` and `dev-down` hold the same lease
across Anvil startup and shutdown. Runtime clients use the loopback gateway URL,
so fixture tooling and application mutations share the same boundary.

The signer takes the lease **before** its final Anvil freshness sample and
holds it through local signing and signed-evidence commit. A mutation already
in progress completes before that sample; later writers wait until the signer
commits or rolls back. The freshness RPC therefore remains outside the
PostgreSQL fence transaction, preserving ADR-0018's no-RPC-under-DB-lock rule.
The bounded database-time deadline still limits lock wait and transaction
duration.

Local runtime evidence: the gateway reported `healthz` 200 on a `127.0.0.1`
ephemeral host port while Anvil had no host port; network inspection showed
PostgreSQL only on `local-only` and the gateway only on `gateway-host` plus
`anvil-private`. A fake account balance mutation through the gateway changed
the durable checkpoint and survived `dev-down`/`dev-up`; `anvil_reset` through
the gateway returned the account to `0x0`, and a later clean restart restored
that state. One initial post-reset startup failed closed; a guarded retry and a
subsequent no-mutation restart both passed. All local P3-01 gates pass; exact
counts are recorded in `TEST_MATRIX.md`. MAX review and exact-SHA CI/Secret Scan
passed for the pushed candidate.

This implementation resolves R-033 only for the supported checkout-local
Compose runtime. A user with host Docker privileges can still bypass the RPC
gateway by directly controlling containers; that host is inside the existing
local trust boundary. It does not widen the scope to public RPC, testnets,
mainnet, real funds, or production custody.

### P3-02 - Signed-unbroadcast lifecycle and control semantics

Depends on P3-01.

Status: **PASS / FRESH INDEPENDENT MAX REVIEW 0.92 / EXACT-SHA CI + SECRET SCAN PASS** on
`b95695c720fd68dd1085e371267a35113a05c816` (CI `35493551667`, Secret Scan
`35493551719`).

Scope:

- Extend control invalidation to evidence-aware `SIGNED`/no-attempt work.
- Atomically quarantine to existing `DISPUTED` operation/reservation states.
- Forbid send after invalidation and retain value.
- Add authenticated proven-no-send recovery prerequisites; do not yet weaken
  post-send recovery.

Acceptance:

- Pause/revoke at every barrier between signed commit and `STARTED` produces
  zero attempt and zero RPC call.
- Signed bytes/evidence are never deleted or reused.
- Unsigned work keeps Phase-1 release behavior; signed work remains retained
  until exact authenticated recovery.
- Duplicate control events are idempotent and auditable.
- DB tests prove all three invalidation-trigger branches: unsigned release,
  signed/no-attempt quarantine, and existing-attempt preservation.

Local implementation uses additive migrations `0027` through `0030`. Control
changes quarantine signed work with no attempt as `DISPUTED` while retaining
its reservation. Existing attempts remain unchanged and receive linked
invalidation audits; exact `ACCEPTED`/`UNKNOWN` chain evidence can reconcile
after control, while a `REJECTED` no-send attempt cannot re-enter broadcast or
be directly released or expired. The `STARTED` writer locks
the same fence prefix, rejects invalidated authority, and creates a
reservation-row conflict with a serializable control snapshot. Generic
`FAILED` recovery and direct release/expiry cannot release invalidated signed
work without an attempt or with a `REJECTED` attempt. Control request IDs
remain idempotent across later state changes, and `CONFLICT` attempts remain
auditable.

P3-02 local evidence: `npm run check` passed (21 repository tests and 361
package tests), `npm run test:db` passed 145/145 across six files including
`execution-evidence.test.ts` 53/53, `npm run test:concurrency` passed 18/18,
and `npm run test:invariants` passed 7/7. Fresh exact-SHA review and protected
CI/Secret Scan passed for its recorded candidate above.

### P3-03 - Send commit, broadcast uncertainty, and durable recovery integration

Depends on P3-02.

Scope:

- Add the fence-first `STARTED` authority transaction and unconditional attempt
  uniqueness.
- Split pre-send current-authority guards from post-send immutable-attempt
  reconciliation guards.
- Wire real local adapter status/recovery evidence for accepted Phase-3 paths.
- Preserve expected-hash recovery and no-resign semantics across crashes and
  response loss.

Acceptance:

- Control-before-`STARTED` prevents send; `STARTED`-before-control remains
  recoverable and cannot release.
- Every crash boundary returns to the same signed/attempt lineage.
- `UNKNOWN`/`CONFLICT` stays held/disputed; canonical success/revert reconciles
  exactly once despite a later fence change.
- No second attempt exists under sequential or concurrent retry.
- No exported/internal-alternate path can invoke a raw send without the exact
  committed `STARTED` row.

P3-03 candidate `510763b3c9c217f9058b1c9d388ce02d84e6ae9e` adds durable
fence-first `STARTED` authority and real local-chain recovery. Recovery accepts
a still-`STARTED` attempt only into the existing canonical evidence verifier;
the crash-after-send regression proves exact mined evidence reconciles once,
even after a control fence changes. Local checks pass: `npm run check` (21
repository checks and 363 package tests), `npm run test:db` (150/150 across
six files, including execution evidence 58/58), and the P2-05D Anvil journey
(1/1). Fresh GPT-5.6 Luna MAX review: **PASS, 9/10, confidence 0.90, no
findings**. Protected exact-SHA CI `35498889238` and Secret Scan `35498889228`
both pass on this candidate. P3-04 candidate
`54afbcc9e08374c844d6b7fd784e34fca1856a19` passed follow-up MAX review with no
blocking findings, protected CI `35787705165`, and Secret Scan `35787705289`.
P3-05's deterministic F01–F19 test crosswalk and local matrix evidence are
recorded in `docs/TEST_MATRIX.md`; F18 fresh-clone verification remains owned
by P3-06. Full Phase-3 acceptance is not claimed.

### P3-04 - Pause/revoke/recovery concurrency and stale-worker fencing

Depends on P3-03.

Scope:

- Make recovery resolution use DB time and exact lease generation.
- Complete signed-no-attempt proven-no-send release.
- Exercise pause, revoke, retry, crash/restart, lease expiry, renewal, takeover,
  and duplicate recovery together.
- Confirm all state/audit/economic writes are transactionally correlated.

Acceptance:

- A stale worker cannot write after expiry or takeover under an adversarial
  barrier at final resolution.
- Proven-no-send release requires exact signed/invalidation/no-attempt proof.
- Proven-no-send ends atomically at operation `RECONCILED`, reservation
  `RELEASED`, resolved lease, one idempotent `FAILED` recovery attempt, and zero
  chain economic-effect rows.
- Send-capable ambiguity can never use that release path.
- Concurrent workers create one recovery result and at most one economic effect.

P3-04 local implementation evidence: migrations `0032` and `0033` add the
exact signed-no-attempt release backstop and the authenticated lease-renewal
audit type. Claim, renewal, and final resolution compare the exact credential
and lease generation using PostgreSQL time; the final resolution conditionally
resolves only a still-live lease. The signed-no-attempt path verifies one exact
authorization and signed transaction, the matching control invalidation, and
zero broadcast attempts/economic effects before atomically reconciling the
operation, releasing the reservation, resolving the lease, and appending the
recovery audits. Local gates pass: `npm run check` (21 repository tests and
363 package tests), `npm run test:db` (162/162 across six files), and
`npm run test:phase3` (254/254), including
barrier-based duplicate recovery, lease-expiry rollback, renewal, takeover,
send-capable no-send rejection, and control/recovery/envelope replacement,
approval replay, autonomous authorization, signer, and broadcaster lock-order
races against reservation transition.
Reservation transitions, authorized envelope replacement, approval replays, and
autonomous retries lock policy decisions and authorization evidence before
operation rows; signer and broadcast stores use the same order. Recovery uses
key-share on policy so policy revocation can proceed without a lock cycle. A
deterministic barrier test proves control invalidation does not pre-lock an
operation while waiting for its authorization row. Follow-up MAX review passed
with no blocking findings after remediation; protected exact-SHA CI
`35787705165` and Secret Scan `35787705289` pass on
`54afbcc9e08374c844d6b7fd784e34fca1856a19`. Obsolete sign-only child sources
were removed, and adapter builds clear stale generated artifacts. P3-05 local
matrix gates pass; its F18 clean-clone proof and final closeout await P3-06.

### P3-05 - Adversarial, replay, substitution, and fault matrix

Status: **LOCAL MATRIX PASS; F18 FRESH-CLONE VERIFICATION RESERVED FOR P3-06**.
The exact named deterministic-test crosswalk is in `docs/TEST_MATRIX.md`.
On the frozen P3-04 state plus the P3-05 test-only diff, local gates pass: DB
163/163, Phase-3 255/255, concurrency 18/18, invariant/property 7/7 (fixed
seeds, 512 runs), chain 10/10, E2E 1/1, fault 186/186, and adversarial 213/213.
P3-04 exact-head protected workflow `35787705165` and Secret Scan `35787705289`
pass; the P3-05 test-only candidate needs its own exact-head checks. F18 and
packet-level final acceptance await the P3-06 fresh-clone run.

Depends on P3-04's frozen state model. Test-only sublanes may run in parallel as
defined below.

Scope:

- Implement P3-F01 through P3-F19 across DB/concurrency, signer/broadcast fault,
  and chain/audit/substitution suites.
- Add property/permutation coverage for authorization kind, fence scope, crash
  point, retry count, lease generation, and evidence outcome.
- Run output, database, audit, repository, and process scans for secrets/raw
  bytes; retain local-only/public-network refusals.

Acceptance:

- Every matrix row has a named deterministic test and expected durable state.
- Owner and autonomous paths share all hard-control tests.
- Replay/substitution creates no authority, attempt, release, or economic effect.
- No critical/high finding remains open inside Phase-3 scope.

### P3-06 - Clean-room gate and independent closeout

Depends on P3-05.

Scope:

- Reproduce from a fresh clone/current candidate SHA and isolated runtime.
- Run the full inherited S0/S1/S2 and Phase-3 gates, migration checks, secret
  scan, artifact/log/state scans, and clean teardown.
- Obtain a fresh independent architecture/security review of the exact candidate.
- Synchronize state, roadmap, workstream, test, risk, changelog, ADR status, and
  provenance without widening scope.

Acceptance:

- Required protected CI and Secret Scan are green on the exact candidate.
- Runtime ownership, chain/fixture identity, ports, volumes, and teardown are
  recorded; no other checkout resources are reused or stopped.
- Review finds no unresolved critical/high Phase-3 issue.
- Only then may Phase 3 / WS-005 be proposed COMPLETE; S3 remains unopened.

## Packet dependency DAG and safe parallelism

```text
ADR-0018 acceptance
        |
      P3-01  pre-sign atomic authority/signing boundary
        |
      P3-02  signed-unbroadcast quarantine/control
        |
      P3-03  send commit + UNKNOWN/recovery integration
        |
      P3-04  control/recovery concurrency + stale-worker fence
        |
      P3-05  adversarial/fault matrix
       /|\
      / | \   test-only sublanes after the P3-04 code SHA is frozen
  DB/race signer/fault chain/audit
      \ | /
      P3-06  clean-room verification + independent closeout
```

P3-01 through P3-04 are sequential. They share migrations, transition writers,
lock order, and the authority model; separate workers must not invent those in
parallel. Within P3-05, at most three workers may operate from the same frozen
P3-04 SHA on disjoint test files:

- database/control/recovery concurrency;
- signer/broadcast crash and response-loss fault injection;
- chain evidence, substitution, audit, leakage, and local-boundary adversarial.

Integration of those sublanes is sequential, followed by P3-06. Documentation
reconciliation may be prepared against a frozen implementation SHA but cannot
claim results until the integrated head is verified.

## Exact verification commands

Focused commands belong in each packet PR and must be followed by inherited
gates. The final clean-room sequence is:

```bash
npm ci
npm run check
npm audit --audit-level=high
npm run dev:up
npm run dev:status
npm run contracts:test
npm run fixture:phase2
npm run test:chain
npm run test:db
npm run test:concurrency
npm run test:invariants
npm run test:phase3
npm run test:e2e
npm run test:fault
npm run test:adversarial
test "$(stat -c %a .local/runtime.env)" = 600
test "$(stat -c %a .local/anvil/anvil.json)" = 600
test "$(stat -c %a .local/phase2-fixture.json)" = 600
source scripts/local-context.sh
test "$(docker compose --project-name "$CRIP_COMPOSE_PROJECT" --env-file .local/runtime.env logs --no-color anvil 2>&1 | wc -l)" -eq 0
npm run dev:down
```

Implementation must add an explicit `npm run test:phase3` script that selects
the P3 suites and must place it in protected CI before the general E2E/fault
closeout steps. If an existing command changes before implementation, update
this plan, the package scripts, and protected workflow together; do not silently
skip the check.

Before and after the run, record:

```bash
git status --short --branch
git rev-parse HEAD
git diff --check
docker compose ps --all
```

The orchestrator must execute `npm run dev:down` in an `EXIT` trap or equivalent
cleanup path and verify the checkout-owned containers are gone. Never delete
or stop resources whose ownership is not proven.

## Stop and escalation conditions

Stop the affected packet, preserve evidence, and escalate if:

- implementation would contradict the Product Spec or an accepted ADR;
- ADR-0018 is not accepted before P3-01 implementation;
- raw signed bytes or private keys must cross/persist outside the restricted
  child to make the design work;
- a provider/public network, real identity, real value, arbitrary signing, or
  new custody boundary appears necessary;
- migration cannot fail closed on ambiguous existing data;
- a send-capable outcome would need cancellation, automatic re-signing, or
  release under uncertainty;
- exact current authority or exact attempt/recovery identity cannot be proven;
- a critical/high security finding remains unresolved;
- clean-room/runtime ownership or exact-SHA evidence cannot be established.

Continue independent packets or tests that do not depend on the blocked choice.

## Phase-3 completion definition

Phase 3 is complete only when P3-01 through P3-06 are integrated, proposed
ADR-0018 is accepted, every Phase-3 matrix row passes at the exact candidate,
all inherited gates and protected CI/Secret Scan are green, independent review
has no unresolved critical/high finding, documentation matches the actual
implementation, clean teardown is proven, and the repository still refuses all
non-local/real-value operation. Planning approval or a green docs-only PR does
not satisfy this definition.

## Execution handoff

A single Luna orchestration agent should consume
`docs/plans/PHASE-3-EXECUTION-HANDOFF.md`, then this plan and ADR-0018. It must
start at ADR acceptance/P3-01, preserve the sequential P3-01 through P3-04
model, use only the bounded P3-05 parallelism above, and finish with P3-06. It
must not redesign the state machine in packet branches.
