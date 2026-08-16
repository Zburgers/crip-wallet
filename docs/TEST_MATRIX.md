# MVP Test Matrix

Owner: security/verification workstream.
Update rule: with every requirement, threat, test, run, skip, failure, or gate change.
Status values: `PLANNED`, `PASS`, `BLOCKED`, `NOT APPLICABLE`.

## Phase-1 closeout snapshot

Protected evidence head: `85545348d369c7860742872acb4da100a5842152`.
Protected CI: `31919254466` — PASS.
Secret Scan: `31919254475` — PASS.

| Check | Result |
| --- | --- |
| `npm ci` | PASS — 156 packages, 0 vulnerabilities |
| `npm run check` | PASS — 20 repository tests + 118 package tests; docs/repository checks pass |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| `npm run dev:up` / `dev:status` | PASS — loopback PostgreSQL + Anvil chain `0x7a69` |
| `npm run test:db` | PASS — 71/71 |
| `npm run test:concurrency` | PASS — 18/18; 4 workers × 32 rounds |
| `npm run test:invariants` | PASS — 7/7; property `numRuns=512` |
| generated-state permission / quiet signer check | PASS |
| `npm run dev:down` | PASS |

These DB, concurrency and invariant suites run inside the protected `validate` workflow required by main ruleset `20791659`.

## Gate evidence

| ID | Requirement | Status | Evidence / next owner |
| --- | --- | --- | --- |
| S0-01 | Secret scanning | PASS | current-head Secret Scan + repository secret controls |
| S0-02 | Dependency lockfile | PASS | committed `package-lock.json` |
| S0-03 | CODEOWNERS | PASS | `.github/CODEOWNERS` |
| S0-04 | Branch protection | PASS | active ruleset `20791659` with required `validate`, deletion and non-fast-forward protections |
| S0-05 | Vulnerability reporting | PASS | `SECURITY.md` |
| S0-06 | No real-wallet material | PASS | local-only runtime/config checks |
| S1-01 | Budget concurrency | PASS | protected 4-worker × 32-round concurrency proof |
| S1-02 | Idempotency | PASS | protected DB replay/conflict/response-loss coverage |
| S1-03 | Approval replay/envelope binding | PASS | WP-07/08 DB + one-winner concurrent consumption |
| S1-04 | Revocation and pause | PASS | four-scope fence races + WP-10 pre-envelope revoke/pause coverage |
| S1-05 | No floating-point money | PASS | canonical atomic-unit schemas + ledger/property proof |
| S1-06 | Protected current-head verification | PASS | CI `31919254466` on `85545348...` |
| S2-01 | Clean-Anvil full transaction journeys | PLANNED | Phase 2/3 |
| S2-02 | Complete trace/audit E2E | PLANNED | Phase 5 |
| S2-03 | Execution-boundary recovery | PLANNED | Phase 3 |

**Gate S1: PASS / ACCEPTED. Phase 2 may open after PR #1 closeout.**

## Product requirements

| ID | Requirement | Status | Evidence / next phase |
| --- | --- | --- | --- |
| PR-001 | Clean clone installs/checks | PASS | protected CI/local bootstrap |
| PR-002 | Anvil 31337 and fake assets only | PASS | local runtime guard; actual transfer Phase 2 |
| PR-003 | owner/agent/wallet/policy fixture | PASS | DB fixtures |
| PR-004 | read-only/review/autonomous modes | PLANNED | Phase 2-4 integration |
| PR-005 | budget under concurrency | PASS | S1-01 |
| PR-006 | chain/asset/recipient/action restrictions | PLANNED | Phase 2 |
| PR-007 | atomic reservation before authorization | PASS | WS-003 |
| PR-008 | retry/idempotency cannot duplicate spend | PASS for ledger / PLANNED for chain | Phase 2/3 execution proof remains |
| PR-009 | intent constructs transaction | PLANNED | Phase 2 |
| PR-010 | independent decode/verification | PLANNED | Phase 2 |
| PR-011 | state-changing operations simulated | PLANNED | Phase 2 |
| PR-012 | immutable envelope after reservation | PASS locally | WS-002/approval binding |
| PR-013 | approval envelope-bound and one-time | PASS locally | WP-07/08; E2E Phase 3 |
| PR-014 | owner/signer key outside agent process | PASS for owner-auth local key boundary / PLANNED for transaction signer | Phase 2 |
| PR-015 | revocation/pause before signing | PASS for S1 control plane / PLANNED at signer boundary | Phase 3 |
| PR-016 | native fee ceiling | PLANNED | Phase 2 |
| PR-017 | MCP/CLI/dashboard share core | PLANNED | Phase 4 |
| PR-018 | no raw signing surface in interfaces | PLANNED | Phase 4 |
| PR-019 | lifecycle telemetry correlation | PLANNED | Phase 5 |
| PR-020 | append-only correlated audit | PASS locally / PLANNED E2E | WS-003 then Phase 5 |
| PR-021 | adapter manifest/conformance | PLANNED | Phase 2 |
| PR-022 | invalid transitions rejected | PASS | WS-002 property proof |
| PR-023 | failures/retries reconcile safely | PASS locally / PLANNED chain | WP-09 plus Phase 2/3 |
| PR-024 | documentation matches behavior | PASS | WP-11 gate reconciliation and closeout review |
| PR-025 | no unresolved critical/high security findings | BLOCKED | final MVP hardening, not Phase-1 gate |
| PR-026 | product-owner MVP sign-off | BLOCKED | MVP not complete |

## Threat/adversarial requirements

| ID | Threat | Status | Evidence / next phase |
| --- | --- | --- | --- |
| TM-001 | total overspend | PASS | ledger invariant |
| TM-002 | concurrent overspend | PASS | protected 32×4 deterministic proof |
| TM-003 | idempotency conflict | PASS | DB retry/conflict |
| TM-004 | duplicate broadcast/evidence | PASS locally | recovery evidence idempotency |
| TM-005 | approval replay | PASS locally | WP-07/08 |
| TM-006 | chain substitution/public RPC | PLANNED | Phase 2 |
| TM-007 | recipient/amount/asset substitution | PLANNED | Phase 2 |
| TM-008 | calldata/extra-call substitution | PLANNED | Phase 2 |
| TM-009 | fee bypass/spike | PLANNED | Phase 2 |
| TM-010 | stale/downgraded policy | PASS locally / PLANNED pre-sign | fence + binding; Phase 3 |
| TM-011 | expired approval | PASS locally | WP-08 |
| TM-012 | revocation/pause race | PASS locally / PLANNED pre-sign | WP-04/10 then Phase 3 |
| TM-013 | permit/unlimited/signature abuse | PLANNED | Phase 2/4 |
| TM-014 | delegatecall/multicall/proxy | PLANNED | Phase 2 |
| TM-015 | token metadata manipulation | PLANNED | Phase 2 |
| TM-016 | RPC disagreement | PLANNED | Phase 2 |
| TM-017 | re-simulation divergence | PLANNED | Phase 2/3 |
| TM-018 | signed-unbroadcast ambiguity | PASS only as local disputed-state primitive / PLANNED real local signer | Phase 3 |
| TM-019 | broadcast persistence timeout | PASS local recovery primitive / PLANNED adapter integration | Phase 3 |
| TM-020 | revert/reorg/receipt confusion | PLANNED | Phase 2 |
| TM-021 | reservation expiry race | PASS core lifecycle / PLANNED E2E | Phase 3 |
| TM-022 | malicious/replayed webhook | NOT APPLICABLE to current local MVP surface | revisit if webhook adapter added |
| TM-023 | audit tampering/omission | PASS locally / PLANNED E2E | DB guards then Phase 5 |
| TM-024 | secret output/log exposure | PASS for local runtime owner/recovery material / PLANNED signer redaction | Phase 2/5 |
| TM-025 | SQL/command injection | PASS for parameterized core paths / PLANNED interface adversarial | Phase 4/5 |
| TM-026 | owner session/CSRF | PASS for ADR-0008 local signed-decision boundary / PLANNED browser session | Phase 4 |
| TM-027 | interface bypass | PLANNED | Phase 4 |
| TM-028 | enforcement overclaim | PLANNED | Phase 2 adapter conformance |
| TM-029 | migration/data loss | PASS for forward/checksum/corrective path / PLANNED backup drill | later hardening |
| TM-030 | dependency/supply chain | PASS for lock/audit/action pins / monitored | ongoing |
