# ADR-0017 - Signer-Local Signed-Byte Broadcast Handoff

**Status:** Proposed

**Date:** 2026-08-31

## Context

ADR-0015 requires exact type-2 signing, a hash derived from the final signed bytes, durable signed evidence and `STARTED` before send, and signer-local raw bytes that never enter control-plane persistence or public output. The current isolated signer meets the signing and safe-output requirements but discards serialized bytes after persisting their hash. The accepted P2-05A broadcaster correctly requires those exact bytes for canonical roundtrip/hash verification and persist-before-send handling. No production composition currently joins the two.

The repository locks `viem` 2.56.0. Its local-account transaction signer serializes the exact transaction, hashes it, signs it through the locked `@noble/curves` secp256k1 implementation with deterministic RFC6979 nonce generation (`extraEntropy: false`), and serializes the signature. For identical key material and exact envelope-v2 fields, signed-byte rematerialization is deterministic under this lock. The implementation must retain a regression vector so a dependency upgrade cannot silently alter that premise.

## Problem

The exact signed bytes cannot reach the accepted broadcaster without either violating signer locality, persisting prohibited material, or adding a trusted internal composition. Crash behavior after signed evidence but before `STARTED` is also undefined while bytes are memory-only.

## Decision

1. Add an adapter-private IDs-only operation, `executeAuthorizedTransfer`, hosted by the isolated local-Anvil execution child. It performs trusted-state reload, pre-sign revalidation, exact signing, durable safe signed evidence, and invokes the existing accepted broadcaster in the same restricted process while retaining raw bytes only in memory.
2. The accepted P2-05A broadcaster remains the sole send boundary. It still canonical-parses and roundtrips the exact bytes, derives and compares the durable expected hash, locks the reservation row, commits `STARTED`, calls loopback Anvil, and records `ACCEPTED`, `UNKNOWN`, `CONFLICT`, or proven `REJECTED` according to its accepted semantics.
3. Raw bytes do not cross child stdout/stderr or normal parent IPC and are never persisted in PostgreSQL, audit, fixture JSON, logs, temp files, or repository state. The parent receives safe normalized identifiers, expected hash, attempt status, and non-secret phase notices only.
4. The public/provider-neutral interface remains IDs-only and exposes no raw transaction, message, digest, `personal_sign`, arbitrary EIP-712, arbitrary calldata, nonce, fee, or key input. This composition is an internal local-Anvil adapter implementation detail, not a universal requirement that future adapters share its process or PostgreSQL topology.
5. A process crash before durable signed evidence permits a normal fresh execution after complete revalidation.
6. If durable signed evidence exists and no broadcast-attempt row exists, a retry may perform **proven-pre-send rematerialization**: acquire the execution serialization lock, reload all current trusted state, repeat full pre-sign revalidation, deterministically sign the exact same v2 transaction only to recover bytes, canonical-roundtrip them, and require their hash to equal the durable expected hash. It may then enter the unchanged broadcaster. Hash mismatch or any stale authority/state fails closed without sending.
7. Rematerialization is forbidden if any send-capable attempt evidence exists. `STARTED`, `ACCEPTED`, `UNKNOWN`, or `CONFLICT` means the send boundary may have been crossed; recovery uses only the durable expected hash and authenticated chain-evidence/ambiguity paths. It never re-signs, reconstructs another transaction, changes nonce/fees, or releases the reservation for response loss.
8. For this packet, an existing `REJECTED` attempt is also not automatically re-signed. Although `REJECTED` denotes proven non-transmission, retry policy and attempt lineage require a separate reviewed fault/retry decision; P2-05D's clean path does not depend on it.
9. The child obtains a per-operation execution serialization lock before sign/rematerialize and holds it through the broadcaster's durable `STARTED` decision. Database unique constraints and the broadcaster's reservation `FOR UPDATE` lock remain the durable backstop. Deterministic test barriers prove a second executor cannot sign after another has made `STARTED` durable.
10. Dependency upgrades affecting transaction serialization or secp256k1 signing require review of the deterministic signed-byte/hash vector and this retry premise.

## Trust boundaries

- Agent/public parent: identifiers and safe metadata only; not trusted with secrets or raw bytes.
- Isolated execution child: disposable key, raw bytes in memory, canonical state reload, and loopback RPC capability.
- PostgreSQL: durable authority, signed hash/evidence, attempt state, locks, and recovery facts; never raw bytes.
- Anvil RPC: loopback-only untrusted evidence/send endpoint; never authorization authority.
- Reconciler: ADR-0014 authenticated evidence boundary after send.

## Persistence model

- No raw-byte column or file is added.
- Existing `signed_transactions`, `broadcast_attempts`, authorization, reservation, envelope, and audit relationships remain authoritative.
- If required, migration `0024` may add only a safe execution idempotency/serialization constraint; the preferred implementation uses existing one-signed-transaction/one-attempt uniqueness plus a namespaced PostgreSQL advisory lock.
- Safe audit events record IDs, hashes, phases, and whether a retry used rematerialization, never serialized bytes or keys.

## Retry and concurrency semantics

| Durable signed evidence | Broadcast attempt | Allowed action |
| --- | --- | --- |
| no | none | Full revalidation, then sign normally |
| yes | none | Serialized, full revalidation; deterministically rematerialize exact bytes; hash-equality gate; then STARTED |
| yes | STARTED | No re-sign; recover by expected hash/evidence |
| yes | ACCEPTED | No re-sign; monitor and reconcile |
| yes | UNKNOWN | No re-sign; recover ambiguity by expected hash/evidence |
| yes | CONFLICT | No re-sign; dispute and recover |
| yes | REJECTED | No automatic re-sign in this packet; separately review retry lineage |

A crash after `STARTED` but before RPC, during RPC, or before response persistence is treated conservatively as possibly sent. A crash after signed evidence but before `STARTED` is proven pre-send because the accepted broadcaster is the only RPC sender and it cannot send without a durable attempt.

## Security invariants

- The bytes sent are the exact bytes whose hash is durable.
- `STARTED` commits before RPC, and ambiguity never releases protected value.
- Raw bytes and private keys stay inside the restricted child's volatile memory.
- Rematerialization is exact, deterministic, hash-gated, serialized, and available only before any send-capable attempt.
- The parent cannot supply or override executable fields.
- The accepted broadcaster and ADR-0014 recovery logic are reused, not reimplemented.

## Alternatives considered

### Dedicated private FD or Unix-socket handoff

Not selected. It can preserve public API narrowness but creates another framing, lifecycle, leakage, authentication, backpressure, and crash boundary without improving the local MVP trust model.

### Parent receives raw bytes

Rejected. It contradicts signer locality, expands logging/error/telemetry exposure, and turns the normal parent interface into a raw signed-transaction channel.

### Persist encrypted raw bytes

Rejected for this packet. It adds key management, file/database lifecycle, deletion, backup, and compromise questions that are unnecessary given deterministic proven-pre-send rematerialization.

### Reimplement broadcast inside the signer

Rejected. The child composes the accepted broadcaster; it does not duplicate its security logic.

## Migration implications

No signed-byte persistence migration is permitted. Both ADR-0016 and this decision may share forward migration number `0024` only for canonical authorization schema and any safe DB serialization constraint. Migrations `0001` through `0023` remain unchanged.

## Test requirements

- Prove normal sign-to-STARTED-to-send, exact hash equality, and safe response/output/DB/audit/key redaction.
- Use deterministic child-process barriers before signed evidence, after signed evidence/before STARTED, and after STARTED/before send.
- Prove permitted rematerialization produces the identical locked vector and rejects hash mismatch, stale authorization, stale nonce, policy/fence change, and fixture reset.
- Prove `STARTED`, `ACCEPTED`, `UNKNOWN`, and `CONFLICT` prohibit rematerialization/re-signing.
- Reject every caller-supplied key/raw/executable field and retain all P2-05A tests unchanged.

## Non-goals

- No public RPC, production custody, general signing API, encrypted raw-byte store, or P2-06 fault-matrix implementation.
- No provider-neutral mandate for this local process topology.
- No implementation or acceptance claim is made by this Proposed ADR.

## Relationship to existing ADRs

This extends ADR-0005, ADR-0009, ADR-0010, ADR-0011, ADR-0012, ADR-0014, and ADR-0015. ADR-0015 is not rewritten. Its exact envelope, signer-local byte, persist-before-send, ambiguity, and recovery requirements remain controlling.

