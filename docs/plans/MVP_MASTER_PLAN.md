# Crip Wallet Local MVP Implementation Plan

> **For implementation agents:** use the repository's Shipyard execution skill and treat `docs/PRODUCT_SPEC.md` as the governing product authority.

**Goal:** deliver a provider-neutral, fake-money local MVP whose authorization, budget, approval, execution and recovery boundaries are reproducibly proven.

## Gate model

The governing Product Spec controls the gates:

```text
S0 — repository safety
  secret scanning, lockfile, CODEOWNERS, branch protection,
  vulnerability reporting, no real-wallet material

S1 — core invariant proof
  budget concurrency, idempotency, approval replay protection,
  revocation/pause proof, integer-only money

S2 — local end-to-end
  clean-Anvil MVP journeys, complete trace/audit evidence,
  recovery paths exercised across the execution boundary
```

A later gate cannot substitute for an earlier one. Local DB proof must not be represented as chain/E2E proof.

## Integration sequence

| Order | Phase / workstream | Entry | Exit evidence |
| --- | --- | --- | --- |
| 1 | Phase 0 / WS-001 | Verified baseline | S0 repository and local-runtime proof |
| 2 | Phase 1 / WS-002 | Accepted ADRs | Canonical contracts, lifecycle and hash vectors |
| 3 | Phase 1 / WS-003 | WS-002 contracts | Atomic ledger, idempotency, DB/concurrency/property proof |
| 4 | Phase 1 / WS-005 S1 slice | WS-002/003 stable | Canonical authorization, authenticated local-owner approval, replay, revocation/pause and local recovery safety proof |
| 5 | Gate S1 | Steps 2-4 complete | Protected current-head S1 verification |
| 6 | Phase 2 / WS-004 | Gate S1 | Construct/verify/simulate/sign/broadcast/confirm/reconcile one fake ERC-20 transfer on Anvil |
| 7 | Phase 3 / WS-005 integration | Stable WS-004 boundary | Approval/control/recovery rechecked at pre-sign, signed-unbroadcast and broadcast-unknown lifecycle points |
| 8 | Phase 4 / WS-006 | Stable core API | MCP/CLI/dashboard parity and browser evidence |
| 9 | Phase 5 / WS-007 | Integrated local product | Telemetry, adversarial/fault evidence and MVP review |

The Phase-1 WS-005 slice was deliberately pulled forward because the governing S1 definition explicitly requires approval replay and revocation/pause proof. This does **not** mean the Phase-3 integrated execution-boundary work is complete.

## Phase 0 — Foundation

Objective: reproducible repository and local-only development boundary.

Acceptance:
- canonical governing documents and accepted blocking ADRs;
- locked dependencies, strict checks, CI, secret scanning and CODEOWNERS;
- loopback-only PostgreSQL and Anvil with generated ignored state;
- branch protection and vulnerability-reporting controls;
- no real-wallet material.

## Phase 1 — Canonical core, ledger and S1 authorization controls

Objective: prove S1 without opening transaction signing or provider/chain execution.

Acceptance:
- strict schemas and deterministic policy/lifecycle behavior;
- forward-only PostgreSQL migrations and balanced reservation accounting;
- deterministic budget concurrency and idempotency proof;
- no alternate authorization path;
- authenticated ADR-0008 local-owner approval evidence bound to approval/envelope/policy/expiry/nonce and consumed once;
- deterministic revocation/pause fencing including the reservation-to-envelope gap;
- hardened local recovery leases using authoritative DB time and authenticated security-relevant fields;
- protected CI executes DB, concurrency and invariant suites.

## Phase 2 — Local EVM vertical slice

Objective: construct, independently decode/verify, simulate, finalize, authorize, locally sign, broadcast, confirm and reconcile one fake ERC-20 transfer on clean Anvil.

Required modules remain `contracts/mock-token/`, `packages/transaction-pipeline/`, `packages/simulation/`, `packages/adapter-sdk/`, `adapters/local-anvil/` and chain/fault tests.

Acceptance includes safe handling of mismatch, revert, insufficient balance/gas, fee ceilings, stale simulation, broadcast ambiguity and receipt discrepancies. Signer secrets must never cross the adapter boundary.

## Phase 3 — Integrated approval, controls and recovery

Objective: carry the already-proven S1 approval/control primitives across the real local execution lifecycle.

Acceptance:
- approval revalidated immediately before signing;
- revocation/pause wins before signing;
- changed envelopes cannot reuse approval;
- signed-unbroadcast and broadcast-unknown cases retain/dispute reservations safely;
- retries never duplicate execution;
- recovery evidence is reconciled against the actual local adapter/chain boundary.

## Phase 4 — Interfaces

Expose the shared core via minimal MCP, strict JSON CLI, loopback API, dashboard and Agent Skill. No interface may bypass the canonical authorization service.

## Phase 5 — Hardening and release review

Complete telemetry, adversarial/property/conformance suites, fault injection, clean-room setup and the formal local-MVP review. Real funds remain prohibited.

## Verification commands

Phase-1 closeout requires:

```bash
npm ci
npm run check
npm audit --audit-level=high
npm run dev:up
npm run dev:status
npm run test:db
npm run test:concurrency
npm run test:invariants
npm run dev:down
```

Later suites are added only when their phase exists; missing chain/E2E/browser suites must remain visible rather than becoming no-op passes.
