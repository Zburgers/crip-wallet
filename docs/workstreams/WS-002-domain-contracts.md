# WS-002 — Canonical Domain Contracts

## Objective and status

Publish strict provider-neutral schemas, deterministic policy/lifecycle semantics,
and envelope hash vectors without persistence or signing. Status: QUEUED.

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
payload hashing, and fast-check transition properties pass with exact seeds.

## Deliverables, integration, documentation, commits

One TDD commit per coherent schema/rule group with docstrings on public exports.
Update architecture, ADR links, Phase-1 plan, matrix and changelog. Freeze contracts
through orchestrator review before WS-003 begins.

## Evidence

None yet; file existence or generated types will not count as acceptance.
