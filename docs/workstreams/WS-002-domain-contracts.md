# WS-002 — Canonical Domain Contracts

## Objective and status

Publish strict provider-neutral schemas, deterministic policy/lifecycle semantics,
and envelope hash vectors without persistence or signing. Status: ACTIVE.

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

- `packages/schemas/src/enforcement-grade.ts` defines the only accepted enum and
  minimum-grade comparison; no coercion or alias path exists.
- 2026-08-10 targeted Vitest: 1 file, 10 tests passed, covering all five exact
  values, eight invalid representations, and all 25 actual/required order pairs.
- Full `npm run check` passed with 15 repository tests plus the 10 schema tests;
  a Node test imports the generated JavaScript through `@crip/schemas` to verify
  the actual workspace package boundary. A clean-artifact `npm run test:unit`
  rebuilt the ignored distribution before executing and passed independently.
