# Phase 1 Canonical Core and Ledger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use shipyard:shipyard-executing-plans to implement this plan task-by-task.

**Goal:** Prove provider-neutral schemas, deterministic policy/lifecycle behavior, and atomic PostgreSQL reservations without signing.

**Architecture:** WS-002 publishes strict leaf contracts first. WS-003 consumes
the frozen contracts through parameterized SQL, serializable transactions,
balanced ledger transitions, idempotency, and transactional audit events.

**Tech Stack:** TypeScript, Zod, PostgreSQL 17, node-postgres, Vitest, fast-check.

---

## Current progress

- Task 1 is committed at `0e19a50`: the exact enforcement-grade enum, exhaustive
  order table, built package boundary, and 10 schema tests pass.
- P1-002 is complete in the focused schema change: strict version-1 read/transfer
  intents and canonical uint256 money now have configured maximum-lifetime
  validation plus a versioned, domain-separated canonical idempotency payload
  hash. The remaining WS-002 contract groups are now implemented and covered by
  strict schema and transition tests; policy-rule evaluation remains a separate
  follow-up task.
- Task 3 is complete: execution envelopes now have deterministic versioned
  serialization, Keccak hash vectors, and approval-binding tests. Task 4 is
  complete: deterministic policy evaluation covers all allowlists, budgets,
  validity, fee ceilings, enforcement grades, modes, combinations, and
  fail-closed indeterminate input. Tasks 5 through 11 have not started. No
  persistence, authorization, signing,
  broadcast, or autonomous execution path exists.

## Ordered tasks

1. Create canonical enforcement-grade schema and strict comparison tests in
   `packages/schemas/src/enforcement-grade.ts` and
   `packages/schemas/test/enforcement-grade.test.ts`.
2. Add versioned intent, policy, decision, lifecycle, envelope, adapter, audit,
   and error schemas one TDD commit each; reject unknown fields and floats.
3. Add canonical serialization and Keccak hash-vector fixtures for ADR-0003.
4. Add deterministic policy rule table and combination tests; unknown is deny.
5. Add explicit lifecycle transition table with invalid-transition property tests.
6. Add forward SQL migration for policies, intents, operations, budget accounts,
   reservations, idempotency, decisions, envelopes, and audit events.
7. Add one-client serializable transaction helper with bounded `40001` retry.
8. Implement reserve/release/expire/finalize/dispute TDD cycles and database
   constraints for `allocated = available + reserved + finalized_spend`.
9. Add deterministic concurrency barriers proving only available value reserves.
10. Add idempotency payload-conflict, retry, transactional audit, and generated
    event-sequence invariant tests.
11. Reconcile the test matrix, risk register, workstreams, changelog, and project
    state; independently review security and the complete Phase-1 diff.

## Required commands and evidence

```bash
npm run test:unit
npm run test:db
npm run test:concurrency
npm run test:invariants
npm run check
npm audit --audit-level=high
```

Exact test names/counts, PostgreSQL image digest, concurrency worker count and
barrier parameters, generated property seeds, migration state, and inspected
ledger rows must be recorded. Phase 2 remains blocked until Gate S1 evidence is
reproducible and no signing surface exists.
