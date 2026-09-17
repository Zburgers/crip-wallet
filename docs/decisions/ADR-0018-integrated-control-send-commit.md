# ADR-0018 - Integrated Control and Send-Commit Boundary

**Status:** Proposed / DRAFT

**Date:** 2026-09-17

## Context

Phase 1 proves one-time owner approval, canonical autonomous authorization,
monotonic `SYSTEM -> OWNER -> AGENT -> POLICY` control fences, and stale-
authority invalidation. Phase 2 proves the local fake-ERC-20 execution path,
including signer-local bytes, durable signed evidence, persist-before-send
`STARTED`, response-loss recovery, and exactly-once reconciliation. Those
proofs do not yet define one serialization boundary across both systems.

The current local adapter commits `AUTHORIZED -> SIGNING` before calling the
cryptographic signer, then commits signed evidence in another transaction.
Control invalidation selects only `AUTHORIZED` operations, and broadcast
`STARTED` checks the reservation but not the current authorization/fence tuple.
This leaves a signed-unbroadcast control race and reverses the governing fence-
first lock order in the signer. Separately, reconciliation after `STARTED` must
remain possible when a later control change makes the original authorization
non-current.

## Decision

### 1. Reuse the existing authority identities

Do not add another epoch or generation abstraction. The authority identity is
the immutable authorization ID plus its four persisted control-fence versions,
policy decision/version, exact envelope ID/revision/hash, reservation, and
expiry. The expected transaction hash and broadcast-attempt ID identify the
send lineage. The existing recovery `lease_version` identifies a recovery
worker generation.

### 2. Make signing one bounded fence-first transaction

The local reference adapter will replace the split durable signing claim and
signed-evidence transactions with one transaction-held signing gate:

1. sample required live local-chain facts before opening the transaction and
   attach their canonical block identity, observation time, and the accepted
   simulation-freshness deadline;
2. lock control fences in `SYSTEM -> OWNER -> AGENT -> POLICY` order;
3. lock and revalidate the exact operation, authorization, reservation,
   envelope, simulation, policy decision, approval/autonomous evidence, and
   signer credential in the documented canonical order;
4. require `AUTHORIZED`, unexpired authority, an exact current fence snapshot,
   and exact live nonce/fee/fixture/simulation bindings;
5. transition to `SIGNING`, perform only bounded local cryptographic signing
   while those locks remain held, insert safe signed evidence, transition to
   `SIGNED`, and commit atomically.

The transaction uses a bounded lock-acquisition deadline that cannot outlive
the shortest authority, simulation, or live-sample deadline. After acquiring
all locks and again before commit, database time must still be before that
deadline. If a lock wait or a deterministic chain-advance barrier makes the
sample stale, the transaction rolls back and the adapter resamples rather than
signing.

No RPC or other unbounded network call occurs while database locks are held.
A process or signing failure rolls back the transaction to `AUTHORIZED`; raw
bytes remain volatile. The commit of signed evidence is the signing
linearization point. A control mutation that gets the fence locks first makes
signing fail; signing that gets them first must commit its exact evidence before
that control mutation can proceed.

### 3. Add a second authority gate at send commit

Immediately before inserting `broadcast_attempts.status = 'STARTED'`, the
broadcaster must use the same fence-first order and lock the exact operation,
authorization, reservation, envelope, signed transaction, and component
credential. It must revalidate the complete authority identity, absence of an
authorization invalidation, exact signed/envelope hash binding, credential,
and absence of any prior attempt.

The commit of `STARTED` is the **send-commit linearization point**. It is the
point after which the transaction is treated as possibly sent, even if the
process crashes before the RPC call. This preserves ADR-0017's conservative
persist-before-send semantics.

### 4. Give control changes state-dependent semantics

- Before the signed-evidence commit, a committed pause/revocation/fence change
  prevents signing and may release the eligible held reservation under the
  existing Phase-1 rules.
- After signed evidence but before `STARTED`, the control mutation invalidates
  the authorization, transitions the operation/reservation to `DISPUTED`, and
  quarantines the signed evidence by state rather than adding a new lifecycle
  enum. It must never broadcast or automatically release.
- After `STARTED`, the control mutation blocks new authority but cannot cancel,
  re-sign, reprice, release, or erase the committed attempt. Monitoring and
  authenticated reconciliation continue by exact hash/attempt evidence.

An authenticated recovery action may release a signed-unbroadcast reservation
only when the database proves the exact signed evidence exists, zero broadcast
attempt rows exist, the authorization was invalidated by the recorded control
event, and the caller holds the current recovery lease. This is proof of no
send through the sole accepted broadcaster, not a chain non-execution guess.

That proof is valid only if the accepted broadcaster is structurally the sole
raw-send gateway. Phase 3 therefore makes raw-sender construction and the old
sign-only entry point private to the restricted execution composition, or
removes them. Agent-facing/provider-neutral code cannot obtain a raw sender,
and every raw-send invocation requires an already-committed matching `STARTED`
row.

Successful proven-no-send recovery is one transaction: insert/reuse one
`FAILED` recovery attempt with reason
`SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT`, change the reservation
`DISPUTED -> RELEASED`, change the operation `DISPUTED -> RECONCILED`, resolve
the lease, and append correlated audits. It asserts that no
`execution_economic_effects` row exists because no chain effect occurred.

### 5. Separate current authority from committed-attempt recovery

Current authority is mandatory through `STARTED` insertion. After that commit,
recovery and reconciliation are authorized by the immutable signed transaction,
attempt, expected hash, authenticated chain evidence, and current recovery
lease. They must not require the original control-fence snapshot still to be
current. A later pause/revocation cannot turn `STARTED`, `ACCEPTED`, `UNKNOWN`,
or `CONFLICT` into releasable failure.

`REJECTED` remains proven pre-acceptance evidence, but it does not manufacture
new authority and does not permit automatic re-signing. Any later retry design
requires a separate reviewed decision.

### 6. Put idempotency backstops in PostgreSQL

Forward migration `0026_ws005_integrated_control_boundary.sql` will add an
unconditional unique signed-transaction identity for an operation/
authorization and an unconditional one-attempt-per-signed-transaction
constraint. Application IDs remain deterministic, but database uniqueness is
the final duplicate-execution backstop. Migration `0026` will also update the
reservation canonical-authorization guard so `AUTHORIZED` requires current
authority while `BROADCAST`/`FINALIZED` are anchored to the immutable committed
attempt lineage.

Migration `0026` also replaces the Phase-1 invalidation-binding trigger with an
evidence-aware matrix: unsigned `AUTHORIZED` work retains the existing
revoke/pause-and-release rule; signed/no-attempt work requires matching
`DISPUTED` operation/reservation state and no release; work with an existing
attempt permits future-authority invalidation while preserving the attempt and
reservation. Exact control-event scope binding remains mandatory in every
branch.

The reservation release trigger is extended to cover `DISPUTED`: a send-capable
attempt always blocks release/expiry, and signed-no-attempt release requires the
exact signed row, zero attempts, matching invalidation, and live lease in the
same transaction.

## Canonical lock order

Phase-3 execution/control transactions use:

1. control fences: `SYSTEM -> OWNER -> AGENT -> POLICY`;
2. approval/autonomous decision and authorization evidence;
3. operation;
4. budget reservation;
5. envelope and simulation/policy evidence;
6. signed transaction and broadcast attempt;
7. recovery lease/attempt when applicable.

Code that cannot acquire rows in that order must split its work before entering
the authority-critical transaction. Tests must use barriers and lock timeouts to
prove ordering; deadlock retry is not a substitute for correct ordering.

## Consequences

- Positive: pause/revocation and signing/send each have explicit database
  linearization points; stale workers cannot create a new signature or attempt.
- Positive: the design reuses the existing four control fences, immutable
  authorization/envelope evidence, attempt identity, and lease version instead
  of creating a parallel epoch system.
- Positive: post-send recovery remains possible after later control changes
  without weakening the pre-send authority gate.
- Negative: the local signer holds database row locks during bounded local
  cryptography. This is acceptable only for the local reference adapter and
  must not include RPC or provider I/O.
- Negative: signed-unbroadcast control races deliberately retain value in
  `DISPUTED` until authenticated proof-driven recovery.
- Security: raw transaction bytes and private keys remain restricted to
  volatile memory in the isolated local execution child.

## Alternatives considered

### Add a new global control epoch or signing-generation table

Not selected. The four existing monotonic fence versions, immutable
authorization/envelope identity, attempt identity, and recovery lease version
already provide the required generations. Another epoch would create two
sources of truth.

### Commit `SIGNING`, sign outside the transaction, then clean up later

Rejected. It preserves a durable half-signing state and needs another lease and
takeover protocol before solving the signed-byte/control race.

### Hold database locks through RPC broadcast

Rejected. RPC is untrusted and unbounded. The `STARTED` commit intentionally
ends the authority transaction before the send call.

### Let any later pause/revocation cancel a `STARTED` attempt

Rejected. Persist-before-send means `STARTED` is possibly sent. Cancellation or
release would overstate control and could duplicate spend.

## Verification

- Deterministic barriers must cover control changes before fence acquisition,
  during bounded signing, after signed-evidence commit, before `STARTED`, after
  `STARTED`/before RPC, and after send/response loss.
- Database tests must prove unconditional uniqueness, canonical lock order,
  all three invalidation-trigger branches, correct state transitions,
  signed-unbroadcast release proof, and the split between current pre-send
  authority and immutable post-send recovery.
- A sole-gateway test must prove no exported/provider-neutral path can obtain a
  raw sender and no raw send occurs without its matching committed `STARTED`.
- Fault/adversarial tests must prove no stale-fence sign/send, no re-sign after
  any attempt, no release under uncertainty, stale lease rejection, and one
  economic effect under retry/takeover.
- Acceptance remains limited to loopback Anvil `eip155:31337`, fake ERC-20,
  disposable identities, and the local reference adapter.

## Related

- `docs/PRODUCT_SPEC.md`
- `docs/plans/PHASE-3.md`
- `docs/workstreams/WS-005-approval-controls.md`
- ADR-0003, ADR-0005, ADR-0008, ADR-0011, ADR-0014, ADR-0015, ADR-0016, ADR-0017
- R-004, R-006, R-008, R-015, R-024, R-030, R-031
