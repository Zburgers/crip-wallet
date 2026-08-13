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
- P1-002 is complete: strict version-1 read/transfer intents and canonical
  uint256 money have configured maximum-lifetime validation plus a versioned,
  domain-separated canonical idempotency payload hash.
- Task 3 is complete: execution envelopes now have deterministic versioned
  serialization, Keccak hash vectors, and approval-binding tests. Task 4 is
  complete: deterministic policy evaluation covers all allowlists, budgets,
  validity, fee ceilings, enforcement grades, modes, combinations, and
  fail-closed indeterminate input. Tasks 1 through 10 and the local Task 11
  integration review are complete. The independent review's implementation
  blockers were remediated and rerun locally; Gate S1 remains blocked on the
  wider approval/revocation authorization proof, protected CI, and external
  acceptance.
  No autonomous authorization, signing, or real execution path exists.

## Ordered tasks

1. Create canonical enforcement-grade schema and strict comparison tests in
   `packages/schemas/src/enforcement-grade.ts` and
   `packages/schemas/test/enforcement-grade.test.ts`.
2. Add versioned intent, policy, decision, lifecycle, envelope, adapter, audit,
   and error schemas one TDD commit each; reject unknown fields and floats.
3. Add canonical serialization and Keccak hash-vector fixtures for ADR-0003.
4. Add deterministic policy rule table and combination tests; unknown is deny.
5. Add explicit lifecycle transition table with invalid-transition property tests. **COMPLETE**
6. Add forward SQL migration for policies, intents, operations, budget accounts,
   reservations, idempotency, decisions, envelopes, and audit events. **COMPLETE**
7. Add one-client serializable transaction helper with bounded `40001` retry. **COMPLETE**
8. Implement reserve/authorize/broadcast/release/expire/finalize/dispute TDD
   cycles and database constraints for
   `allocated = available + reserved + finalized_spend`. **COMPLETE**
9. Add deterministic concurrency barriers proving only available value reserves. **COMPLETE**
10. Add idempotency payload-conflict, worker-retry, serialization-retry,
    transactional-audit, ambiguous-funds, migration-recovery, and generated
    event-sequence invariant tests. **COMPLETE**
11. Reconcile the test matrix, risk register, workstreams, changelog, and project
    state; complete local security review and freeze shared contracts. **COMPLETE LOCALLY**

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
reproducible, independent review is accepted, and no signing surface exists.

Current reproducibility parameters: fast-check lifecycle seed `2026081301`,
malformed-input seed `2026081302`, event-sequence seed `2026081303`, `512`
property runs, concurrency workers `4`, concurrency rounds `32`,
`ready/start/release` barrier, `5000 ms` barrier timeout, and loopback PostgreSQL
`127.0.0.1:55432` (`crip_wallet`, user `crip`). Migration state is twelve applied
forward migrations with checksums recorded in `schema_migrations`; no
down-migration or destructive migration API exists.
