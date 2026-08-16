# WS-002 — Canonical Domain Contracts

## Objective and status

Publish strict provider-neutral schemas, deterministic lifecycle semantics, and
envelope hash vectors without persistence or signing. Status: FROZEN LOCALLY —
canonical contracts, policy evaluation, lifecycle properties, and hash vectors
reviewed; remote CI is green, and no Phase-2 consumer may alter them without an
additive contract review and Gate S1 acceptance.

## Governing sections

Product spec 10–17, 19–20, 23, 26, 29–30, 34; ADRs 0001, 0003, 0004,
0007, 0009, 0010, 0012; `docs/plans/PHASE-1.md`.

## Scope and ownership

Own `packages/schemas/`, `packages/core/`, `packages/policy-engine/` and their
unit/property tests. Out of scope: SQL, reservations, signing, RPC, approval UI,
MCP/CLI/dashboard, and provider SDKs.

## Dependencies and shared contracts

Depends on Phase-0 toolchain. Owns intent, policy, decision, lifecycle, envelope,
adapter manifest, audit, telemetry name, ID, and error contracts until accepted.
No consumer may independently change them.

## Security invariants

- Strict versions and unknown-field rejection.
- Atomic integer money and canonical uppercase grades.
- Unknown/indeterminate policy fails closed.
- Invalid lifecycle transition is impossible through the public API.
- Envelope bytes/hash are deterministic, domain-separated, and immutable.

## Acceptance and tests

Golden JSON/hash fixtures, positive/negative schema tests, deterministic policy
tables, grade comparison, all invalid transitions, no-float tests, idempotency
payload hashing, and exhaustive lifecycle transition properties pass.

## Deliverables, integration, documentation, commits

One TDD commit per coherent schema/rule group with docstrings on public exports.
Update architecture, ADR links, Phase-1 plan, matrix and changelog. Freeze contracts
through orchestrator review before WS-003 begins.

## Evidence

- `packages/schemas/src/enforcement-grade.ts` defines the only accepted enum and
  minimum-grade comparison; no coercion or alias path exists.
- 2026-08-10 targeted Vitest: 1 file, 10 tests passed, covering all five exact
  values, eight invalid representations, and all 25 actual/required order pairs.
- Full `npm run check` passed with 15 repository tests plus the 10 schema tests;
  a Node test imports the generated JavaScript through `@crip/schemas` to verify
  the actual workspace package boundary. A clean-artifact `npm run test:unit`
  rebuilt the ignored distribution before executing and passed independently.
- The next red-first slice adds strict version-1 `wallet.read_state` and
  `asset.transfer` intent branches plus canonical uint256 atomic strings. The 31
  targeted cases cover the maximum uint256 boundary, floats/numbers/signs,
  leading zeros, unknown top/nested fields, malformed CAIP-2, mixed-case EVM
  addresses, generic calls, UTC form, and time ordering. Configured maximum
  lifetime and idempotency payload hashing were subsequently completed and are
  covered by the 2026-08-13 P1-002 evidence below.
- Full post-slice `npm run check`: 15/15 repository tests and 41/41 schema tests;
  the malformed-decimal negative cases also prove validation returns failure
  instead of throwing from uint256 conversion.
- Oversized atomic strings are rejected by bounded lexical comparison without
  `BigInt` conversion; the non-authoritative display hint is capped at 160
  characters and documented as excluded from authorization/math.
- 2026-08-13 P1-002 targeted Vitest: 2 files, 37 tests passed. The new cases
  prove a configured `maximumLifetimeSeconds` bound (including the exact
  boundary), recursive canonical key ordering, stable hash-vector output,
  insertion-order independence, and payload-change sensitivity. The exported
  `hashIdempotencyPayload` uses SHA-256 over a versioned domain separator plus
  canonical JSON; it is an idempotency identity helper, not an envelope or
  signing hash.
- The default schema remains bounded to a conservative 900-second local intent
  lifetime, while consumers can create a strict schema with their configured
  positive whole-second limit. No persistence, authorization, signing, RPC, or
  real-money path was added.
- 2026-08-13 WS-002 contract slice targeted Vitest: 1 file, 39 tests passed.
  Policy, policy-decision, lifecycle state/transition, execution-envelope,
  adapter capability, audit-event, telemetry identifier, and stable-error
  contracts reject unknown fields, floats, unsupported values, and invalid
  lifecycle transitions. The focused implementation builds through the real
  `@crip/schemas` package boundary and adds no persistence, signing, RPC, or
  real-money path.
- 2026-08-13 envelope serialization targeted Vitest: 1 file, 8 tests passed.
  Canonical UTF-8 bytes sort object keys recursively, the hash preimage uses
  `crip/execution-envelope` plus `v1`, and the Keccak-256 vector is
  `0xc3ff8d861b4122480cd59825b1d772816597bbc7219bf67ba2a43a4ba0e59e5f`.
  Bound-field changes diverge and an approval bound to the old derived hash is
  rejected. `@noble/hashes` is pinned at 2.3.0; no persistence, signing, RPC,
  or real-money path was added.
- 2026-08-13 deterministic policy evaluation targeted Vitest: 1 file, 17
  tests passed. The evaluator covers chain, asset, recipient, action, per-
  transaction and total budgets, native fee ceilings, policy/intent validity,
  enforcement-grade minimums, read-only/review-required/autonomous modes,
  multi-rule combinations, and malformed/indeterminate input. Any
  indeterminate input returns `DENY` with an explicit `input.contract` rule;
  the evaluator never returns an indeterminate final decision.
- 2026-08-13 lifecycle transition properties targeted Vitest: 1 file, 4 tests
  passed. The immutable adjacency table is checked over every canonical state
  pair, malformed state inputs fail closed, terminal/exceptional recovery edges
  remain explicit, and invalid transitions raise the stable transition error.
- The audit contract now includes the explicit
  `budget.reservation.broadcast` event and typed `reason`, `proofReference`, and
  `nonce` data fields required by the WS-003 reservation lifecycle. Shared
  contracts are frozen locally pending Gate S1 and required review acceptance;
  additive changes require a new contract review.
