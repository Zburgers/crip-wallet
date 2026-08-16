# ADR-0007: TypeScript, PostgreSQL, and workspace tooling

## Status

Accepted — 2026-08-10

## Context

The governance-only baseline needs a small, reproducible monorepo and explicit
transaction control without speculative infrastructure.

## Decision

Use strict TypeScript on supported Node.js LTS, npm workspaces, and the committed
root `package-lock.json`. Use PostgreSQL 17 for MVP persistence. Use node-postgres
with parameterized SQL and repository-owned forward migrations; do not add an
ORM until evidence shows it improves correctness without hiding transaction or
locking behavior.

Use Vitest for unit/property tests and direct PostgreSQL integration tests.
Formatting, linting, type checking, tests, dependency audit, and secret scanning
are root scripts and CI gates. Container images and GitHub actions are digest or
commit pinned where practical.

## Alternatives considered

- Turborepo/Nx: deferred; the initial graph is too small to justify another
  orchestration layer.
- ORM migrations: deferred because ledger correctness benefits from reviewable
  SQL and explicit transaction boundaries.
- SQLite: rejected for the concurrency proof.

## Consequences

- Shared contracts live in leaf packages with no application imports.
- SQL is parameterized and transaction helpers use one checked-out client.
- Workspace additions update the root lockfile and CI.

## Verification

- Fresh `npm ci`, format, lint, typecheck, unit, and integration commands.
- PostgreSQL serialization/concurrency tests on clean containers.

## Related

- Product spec sections 26, 32, 33, and Phase 0.
- Workstreams WS-001 through WS-003.
