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
| S2-01 | Clean-Anvil full transaction journeys | PLANNED | Phase 2 complete vertical slice; Phase 3 adds integrated control/recovery proof |
| S2-02 | Complete trace/audit E2E | PLANNED | Phase 5 |
| S2-03 | Execution-boundary recovery | PLANNED | Phase 2 ambiguity primitives + Phase 3 integrated control proof |

**Gate S1: PASS / ACCEPTED. Phase 2 / WS-004 is OPEN. Gate S2 remains NOT PASSED.**

ADR-0015 is accepted architectural authority, not test evidence. It removes the previous P2-02 architecture blocker but no Phase-2 threat/product row becomes PASS until the named implementation test exists and protected current-head evidence is recorded.

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
| PR-009 | intent constructs transaction | PLANNED | P2-02 |
| PR-010 | independent decode/verification | PLANNED | P2-02 |
| PR-011 | state-changing operations simulated | PLANNED | P2-03 |
| PR-012 | immutable envelope after reservation | PASS locally / PLANNED exact-EVM v2 | WS-002 approval binding; P2-02 exact signed-field proof |
| PR-013 | approval envelope-bound and one-time | PASS locally | WP-07/08; E2E Phase 3 |
| PR-014 | owner/signer key outside agent process | PASS for owner-auth local key boundary / PLANNED for transaction signer | P2-04 |
| PR-015 | revocation/pause before signing | PASS for S1 control plane / PLANNED at signer boundary | Phase 3 |
| PR-016 | native fee ceiling | PLANNED | P2-03/P2-04 |
| PR-017 | MCP/CLI/dashboard share core | PLANNED | Phase 4 |
| PR-018 | no raw signing surface in interfaces | PLANNED | P2-04 local adapter + Phase 4 public interfaces |
| PR-019 | lifecycle telemetry correlation | PLANNED | Phase 5 |
| PR-020 | append-only correlated audit | PASS locally / PLANNED E2E | WS-003 then Phase 5 |
| PR-021 | adapter manifest/conformance | PLANNED | P2-04 |
| PR-022 | invalid transitions rejected | PASS | WS-002 property proof |
| PR-023 | failures/retries reconcile safely | PASS locally / PLANNED chain | WP-09 plus P2-05/06 and Phase 3 |
| PR-024 | documentation matches behavior | PASS for current S0/S1 state / PLANNED continuously | current gate/ADR reconciliation; re-evaluate every packet |
| PR-025 | no unresolved critical/high security findings | BLOCKED | final MVP hardening, not Phase-1 gate |
| PR-026 | product-owner MVP sign-off | BLOCKED | MVP not complete |

## Threat/adversarial requirements

| ID | Threat | Status | Evidence / next phase |
| --- | --- | --- | --- |
| TM-001 | total overspend | PASS | ledger invariant |
| TM-002 | concurrent overspend | PASS | protected 32×4 deterministic proof |
| TM-003 | idempotency conflict | PASS | DB retry/conflict |
| TM-004 | duplicate broadcast/evidence | PASS locally | recovery evidence idempotency; real local broadcast proof P2-06 |
| TM-005 | approval replay | PASS locally | WP-07/08 |
| TM-006 | chain substitution/public RPC | PLANNED | P2-01/P2-03/P2-04 |
| TM-007 | recipient/amount/asset substitution | PLANNED | P2-02 |
| TM-008 | calldata/extra-call substitution | PLANNED | P2-02 |
| TM-009 | fee bypass/spike | PLANNED | P2-03/P2-04 |
| TM-010 | stale/downgraded policy | PASS locally / PLANNED pre-sign | fence + binding; Phase 3 |
| TM-011 | expired approval | PASS locally | WP-08 |
| TM-012 | revocation/pause race | PASS locally / PLANNED pre-sign | WP-04/10 then Phase 3 |
| TM-013 | permit/unlimited/signature abuse | PLANNED | P2-02/P2-04/Phase 4 |
| TM-014 | delegatecall/multicall/proxy | PLANNED | P2-02 |
| TM-015 | token metadata manipulation | PLANNED | P2-01/P2-02 |
| TM-016 | RPC disagreement | PLANNED | P2-03/P2-05 |
| TM-017 | re-simulation divergence | PLANNED | P2-03/Phase 3 |
| TM-018 | signed-unbroadcast ambiguity | PASS only as local disputed-state primitive / PLANNED real local signer | P2-04/P2-06 then Phase 3 |
| TM-019 | broadcast persistence timeout | PASS local recovery primitive / PLANNED adapter integration | P2-05/P2-06 then Phase 3 |
| TM-020 | revert/reorg/receipt confusion | PLANNED | P2-05/P2-06 |
| TM-021 | reservation expiry race | PASS core lifecycle / PLANNED E2E | Phase 3 |
| TM-022 | malicious/replayed webhook | NOT APPLICABLE to current local MVP surface | revisit if webhook adapter added |
| TM-023 | audit tampering/omission | PASS locally / PLANNED E2E | DB guards then Phase 5 |
| TM-024 | secret output/log exposure | PASS for local runtime owner/recovery material / PLANNED signer redaction | P2-04/P2-06/Phase 5 |
| TM-025 | SQL/command injection | PASS for parameterized core paths / PLANNED interface adversarial | Phase 4/5 |
| TM-026 | owner session/CSRF | PASS for ADR-0008 local signed-decision boundary / PLANNED browser session | Phase 4 |
| TM-027 | interface bypass | PLANNED | Phase 4 |
| TM-028 | enforcement overclaim | PLANNED | P2-04 adapter conformance |
| TM-029 | migration/data loss | PASS for forward/checksum/corrective path / PLANNED backup drill | later hardening |
| TM-030 | dependency/supply chain | PASS for lock/audit/action pins / monitored | ongoing; `viem` lock/audit at P2-02 |
| TM-031 | constructor self-verification | PLANNED | P2-02 `viem` encoder + independent strict parser + mutation vectors |
| TM-032 | unbound signer transaction fields | PLANNED | ADR-0015 ACCEPTED; P2-02 v2 schema/DB/hash proof + P2-04 exact signer proof |
| TM-033 | response-loss false failure/release | PLANNED | P2-05/P2-06 persist-before-send expected-hash/attempt fault proof |
| TM-034 | receipt/cross-operation substitution | PLANNED | P2-05 transaction/receipt/log matching + ADR-0014 authenticated reconciler proof |
| TM-035 | local-chain reset confusion | PLANNED | P2-01 fixture fingerprint and P2-03/P2-05/P2-06 boundary checks |

## Phase-2 implementation matrix

The packet-level `requirement -> test -> suite -> packet -> evidence` matrix, including inherited S0/S1 gates, is maintained in `docs/plans/PHASE-2.md`. ADR-0015 is accepted and P2-02 is no longer blocked on product-owner architecture approval. No Phase-2 row is PASS until the named test exists and protected current-head evidence is recorded here.
