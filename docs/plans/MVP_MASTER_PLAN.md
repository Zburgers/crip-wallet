# Crip Wallet Local MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use shipyard:shipyard-executing-plans to implement this plan task-by-task.

**Goal:** Deliver the governing-spec local fake-money MVP with reproducible proof
that no request, retry, race, policy change, or failure can authorize beyond the
active owner policy.

**Architecture:** Provider-neutral contracts feed one deterministic authorization
service, PostgreSQL serializes budgets and lifecycle state, and a restricted local
adapter alone reaches Anvil 31337. Approval and autonomous authorization bind to
immutable post-reservation envelopes; every interface consumes the same core.

**Tech Stack:** Node.js 24 LTS, strict TypeScript, npm workspaces, PostgreSQL 17,
node-postgres, Zod, Vitest/fast-check, Viem, Foundry/Anvil, Solidity, OpenTelemetry,
MCP TypeScript SDK, React/Next.js and Playwright when their phases begin.

---

Owner: lead orchestrator. Update rule: after accepted scope/ADR changes, phase
gate review, integration reordering, or material evidence. Each phase receives a
detailed `PHASE-N.md` plan before its implementation starts.

## Release-backward gates

```text
MVP sign-off
<- Phase 5 adversarial/telemetry evidence and no critical/high findings
<- Phase 4 interface parity and truthful browser UX
<- Phase 3 approval/revocation/pause/recovery proof
<- Phase 2 fake ERC-20 construct/verify/simulate/sign/reconcile proof
<- Phase 1 deterministic schemas/policy/ledger concurrency proof (Gate S1)
<- Phase 0 reproducible repository, local services, CI and governance (Gate S0)
```

No later gate may substitute for an earlier one. Synthetic unit checks do not
promote database, chain, E2E, browser, or production claims.

## Shared contracts and change control

Intent, policy, decision, enforcement grade, operation state, envelope, adapter
manifest, error, audit, telemetry, database IDs, MCP schemas, and CLI JSON are
shared. Their owner is WS-002 until stable, then the lead. A change requires an
affected-workstream list, schema/migration tests, compatibility notes, and a
security ADR when it changes authority or trust.

## Integration sequence

| Order | Phase/workstream | Entry                   | Exit evidence                                       | Parallelism                                          |
| ----- | ---------------- | ----------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| 1     | Phase 0 / WS-001 | Verified baseline       | Fresh install/check, services, CI, S0 report        | Single owner                                         |
| 2     | Phase 1 / WS-002 | Accepted ADRs           | Canonical schemas, lifecycle/hash vectors           | Single owner                                         |
| 3     | Phase 1 / WS-003 | WS-002 contracts frozen | DB migration, ledger concurrency/property proof     | One security-critical owner                          |
| 4     | Phase 2 / WS-004 | Gate S1                 | Mock token and full local transaction pipeline      | Split contracts/adapter only after interfaces freeze |
| 5     | Phase 3 / WS-005 | Stable envelope/adapter | Approval, controls and recovery proof               | Single owner across shared lifecycle                 |
| 6     | Phase 4 / WS-006 | Core API stable         | MCP/CLI/dashboard parity and browser evidence       | Interfaces may parallelize by non-overlap            |
| 7     | Phase 5 / WS-007 | Integrated product      | Telemetry, adversarial/fault evidence, audit report | Reviewer independent from feature authors            |

## Workstream contract

Every workstream document owns objective, governing sections, files, dependencies,
shared contracts, out-of-scope, invariants, acceptance tests, integration order,
documentation, evidence, and atomic commit expectations. Agents receive a
self-contained prompt grounded in those files and the exact base SHA. The lead
independently reruns verification and reviews the integrated diff.

## Phase 0 — Foundation

Objective: reproducible repository and local-only development boundary. Execute
`docs/plans/PHASE-0.md` and WS-001.

Acceptance:

- Canonical single governing spec and accepted blocking ADRs.
- Real governance docs with current evidence and update rules.
- Committed lockfile, strict static tooling, CI, secret scanning, CODEOWNERS.
- Digest-pinned loopback PostgreSQL and Anvil start from ignored generated state.
- `npm ci && npm run check` and local service health run from this branch.
- External review and acceptance gaps remain explicit; they do not become false
  local passes.

## Phase 1 — Canonical core and ledger

Objective: prove policy and budget authority without any signing. Execute
`docs/plans/PHASE-1.md`, WS-002, then WS-003.

Acceptance:

- Strict versioned schemas reject unknown fields and non-canonical grades.
- Deterministic policy and lifecycle transition tables pass golden tests.
- PostgreSQL forward migration enforces monetary and idempotency constraints.
- Ledger invariant holds under release, expiry, finalization, dispute, retries,
  and deterministic concurrent reservations.
- Transactional audit records correlate every decision.
- No signing, broadcast, arbitrary-call, MCP, or dashboard surface lands.

## Phase 2 — Local EVM vertical slice

Objective: on clean Anvil, construct, independently decode/verify, simulate,
finalize, authorize, locally sign, broadcast, confirm, and reconcile one fake
ERC-20 transfer.

Required modules: `contracts/mock-token/`, `packages/transaction-pipeline/`,
`packages/simulation/`, `packages/adapter-sdk/`, `adapters/local-anvil/`, and
chain/fault tests. Use TDD and current Context7 docs for Viem/Foundry before code.

Acceptance: mismatches, reverts, insufficient balances/gas, fee ceiling, stale
simulation, broadcast ambiguity, and receipt discrepancies fail or reconcile
safely; signer secrets never cross the adapter boundary.

## Phase 3 — Approval and controls

Objective: implement local owner approval, one-time consumption, pause,
revocation, lifecycle fencing, leased recovery, and uncertain outcomes.

Acceptance: changed envelopes cannot reuse approval; revocation/pause races lose
before signing; signed-unbroadcast and broadcast-unknown cases retain/dispute
reservations; retry never duplicates execution.

## Phase 4 — Interfaces

Objective: expose the shared core via minimal MCP, strict JSON CLI, loopback API,
dashboard, and Agent Skill.

Acceptance: same intent yields the same decision through every interface; no raw
signing/policy expansion; owner UX shows envelope, simulation, fee, grade,
uncertainty, and local-test warnings; Playwright verifies approval, denial,
revocation, pause, replay, and failure journeys.

## Phase 5 — Hardening and release review

Objective: complete OpenTelemetry evidence, adversarial/property/conformance
suites, fault injection, recovery proof, dependency/security audit, clean-room
setup, and the formal MVP review.

Acceptance: Gate S1 and S2 pass with exact artifacts; every matrix row is PASS or
explicitly approved not-applicable; no critical/high finding remains; documents
match behavior; product owner signs off. Real funds remain prohibited.

## Commit expectations

Each TDD cycle and coherent governance/tooling unit is a focused commit with its
tests/docs. Security-critical changes never share commits with unrelated cleanup.
Every phase ends with an integration-state commit containing plan, workstream,
risk, matrix, changelog, and exact test evidence updates.

## Master verification commands

```bash
npm ci
npm run check
npm audit --audit-level=high
npm run dev:up
npm run dev:status
npm run test:db
npm run test:concurrency
npm run test:invariants
npm run test:chain
npm run test:adversarial
npm run test:e2e
npm run test:browser
```

Commands are added to the full gate only when implemented; missing suites remain
visible gaps and never become no-op passes.
