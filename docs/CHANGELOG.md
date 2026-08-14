# Changelog

Owner: lead orchestrator. Update rule: record user/operator-visible, schema,
security, policy, compatibility, dependency, or governance-authority changes in
the same integration change.

## Unreleased

### Changed

- Reconciled Phase-0/Phase-1 plans, project state, workstreams, risk register,
  and test matrix with the verified remote state as of 2026-08-14. PR #1 head
  `081fe78` passed `validate` and Gitleaks; the active main protection ruleset
  and Dependabot security fixes are recorded. Phase 2 remains intentionally
  unopened while Gate S1 stays blocked on authorization/control and review
  evidence.
- Accepted ADR-0013 and selected the MIT License; added the root license text,
  SPDX package metadata, and updated README/contribution guidance.
- Normalized governing document paths to `docs/PRODUCT_SPEC.md` and
  `docs/LEAD_ORCHESTRATOR_PROMPT.md` without duplicate authorities.
- Clarified the budget invariant, envelope finalization order, enforcement-grade
  enum, revocation lifecycle, forward-only migration recovery, and separate
  native network-fee ceiling.

### Added

- Phase-0 ADRs, architecture, threat/security/testing guidance, roadmap, project
  state, risk register, test matrix, master/phase plans, and workstreams.
- Repository contribution and vulnerability-reporting guidance.
- Locked npm workspace tooling for formatting, linting, strict type checking,
  unit/repository tests, documentation checks, and repository policy checks.
- Digest-pinned loopback PostgreSQL and deterministic quiet Anvil services with
  generated ignored credentials, fail-closed local configuration validation,
  stable public-account verification, per-checkout Compose isolation, and
  defensive lifecycle commands.
- Least-privilege CI and full-history Gitleaks workflows with commit-pinned
  actions, CODEOWNERS, Dependabot configuration, and contribution templates.
- Canonical Zod enforcement-grade contract with the single uppercase enum and
  exhaustive strongest-to-weakest minimum-grade comparison tests.
- Strict version-1 MVP intent union and canonical uint256 atomic-unit contract;
  unknown fields, generic calls, floating values, malformed identifiers,
  noncanonical addresses, and invalid time ordering are rejected.
- Configured maximum intent-lifetime validation and versioned canonical
  idempotency payload hashing for the strict Phase-1 schema contract. The hash
  is local/provider-neutral identity metadata and is not a signing primitive.
- Strict WS-002 policy, policy-decision, lifecycle transition, execution-envelope,
  adapter capability, audit-event, telemetry identifier, and stable-error
  contracts. Unknown fields, floating values, unsupported enum values, and
  invalid lifecycle transitions are rejected at the schema boundary.
- Added canonical execution-envelope UTF-8 serialization and versioned,
  domain-separated Keccak-256 hashing with a golden vector and approval-binding
  checks. Added the pinned `@noble/hashes` 2.3.0 dependency for Keccak-256.
- Added deterministic policy evaluation for allowlists, budgets, fee ceilings,
  validity, enforcement grades, execution modes, combined failures, and
  fail-closed indeterminate input through the built `@crip/policy-engine`
  package boundary.
- Added a deeply immutable lifecycle adjacency table with exhaustive canonical
  state-pair and malformed-input property tests covering terminal and exceptional
  recovery states.
- Added the WS-003 forward-only PostgreSQL ledger migrations and
  @crip/audit and @crip/budget-ledger packages. The schema covers policies,
  intents, operations, envelopes, decisions, budget accounts, reservations,
  idempotency, and append-only audit events with foreign keys, status checks,
  immutable records, balanced numeric accounting, and corrective migration
  checksums.
- Added one-client serializable transaction execution with bounded SQLSTATE
  40001 retry plus reserve/release/expire/finalize/dispute transitions,
  idempotency replay/conflict handling, transactional audit hash chaining, and
  real PostgreSQL invariant/concurrency evidence (11 DB tests, 32 concurrency
  rounds, and 6 invariant tests).
- Added real Phase-1 `test:db`, `test:concurrency`, and `test:invariants` gates,
  pinned `fast-check` 4.9.0, and canonical seed/worker/barrier parameters.
  Missing database or concurrency suites fail closed instead of reporting empty
  passes.
- Completed the local Phase-1 concurrency/idempotency proof: request-bound
  replay/conflict fencing, concurrent worker retry coalescing, response-loss
  replay, real PostgreSQL serialization retry, typed full-event audit hashes,
  authorization/broadcast evidence fencing, operation-to-budget binding,
  migration runner recovery, generated accounting/event sequences, and
  ambiguous-funds retention. Shared contracts are frozen locally; Gate S1 remains
  blocked and Phase 2 has not started.
- Added explicit pending-to-verified broadcast evidence reconciliation, immutable
  evidence rows, row-bound database audit hashing, legacy-audit fail-closed
  migration handling, and immutable operation/budget ownership bindings.

### Security

- Moved transient Anvil signer/config generation into the container's writable
  `/tmp` and copied the result back with host mode `0600`, removing the
  Linux-runner UID mismatch from the local-only fake-money service path.
- Recorded the real-funds prohibition and fail-closed local-chain boundary as
  release blockers.
- Recorded the initial branch-protection gap; the active `S0 main protection`
  ruleset now mitigates it, pending required review/merge acceptance.
- Refuse non-local environment, public chain, non-loopback RPC/database hosts,
  and invalid port configuration before local services start; generated
  sensitive files are created at mode `0600` and Anvil key logs are suppressed.
