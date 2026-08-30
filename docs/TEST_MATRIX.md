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

## Phase-2 local fixture evidence

This is packet evidence only. It does not promote Gate S2, which also requires
the later construction, signing, broadcast, confirmation, reconciliation and
fault/ambiguity packets.

Protected remediation evidence head: `25e8147f7439af5722dafe092a33dd1351c15280`.
Protected CI: `33189082028` — PASS (`validate` job `98909614058`).
Secret Scan: `33189082181` — PASS.

| Check | Result |
| --- | --- |
| `npm run contracts:test` | PASS — 10/10 MockERC20 Forge tests through the digest-pinned Foundry image |
| `npm run fixture:phase2` | PASS — Anvil `eip155:31337`, deterministic token address, deployment receipt, metadata, supply, code hash and cryptographically random fixture instance verified; fixture mode `0600` |
| `npm run test:chain -- fixture.test.ts` | PASS — 9/9 local fixture and boundary tests, including reset → redeploy with a different `fixtureInstanceId` and stale rejection of the prior instance |
| missing chain suite | PASS — fail-closed with a nonzero exit |

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
| PR-002 | Anvil 31337 and fake assets only | PASS | local runtime guard + P2-01 fixed-supply MockERC20 transfer gate |
| PR-003 | owner/agent/wallet/policy fixture | PASS | DB fixtures |
| PR-004 | read-only/review/autonomous modes | PLANNED | Phase 2-4 integration |
| PR-005 | budget under concurrency | PASS | S1-01 |
| PR-006 | chain/asset/recipient/action restrictions | PLANNED | Phase 2 |
| PR-007 | atomic reservation before authorization | PASS | WS-003 |
| PR-008 | retry/idempotency cannot duplicate spend | PASS for ledger / PLANNED for chain | Phase 2/3 execution proof remains |
| PR-009 | intent constructs transaction | PASS locally / PLANNED protected | P2-02 integration: `packages/transaction-pipeline/test/transfer-core.test.ts` |
| PR-010 | independent decode/verification | PASS locally / PLANNED protected | P2-02 integration: independent decoder and static verifier mutation tests |
| PR-011 | state-changing operations simulated | PASS locally / PLANNED protected | P2-03 unit + loopback chain simulation (20 focused unit tests, 1 chain test) |
| PR-012 | immutable envelope after reservation | PASS locally / PLANNED exact-EVM v2 | WS-002 approval binding; P2-02 exact signed-field proof |
| PR-013 | approval envelope-bound and one-time | PASS locally | WP-07/08; E2E Phase 3 |
| PR-014 | owner/signer key outside agent process | PASS for owner-auth local key boundary / PLANNED for transaction signer | P2-04 |
| PR-015 | revocation/pause before signing | PASS for S1 control plane / PLANNED at signer boundary | Phase 3 |
| PR-016 | native fee ceiling | PASS locally / PLANNED protected | P2-03 integer max-cost, native-balance and fee-escalation tests |
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
| TM-006 | chain substitution/public RPC | PASS for P2-01 fixture boundary / PLANNED E2E | loopback/31337 guards; P2-03/P2-04 |
| TM-007 | recipient/amount/asset substitution | PASS locally / PLANNED protected | P2-02 static verifier mutation tests |
| TM-008 | calldata/extra-call substitution | PASS locally / PLANNED protected | P2-02 strict 68-byte decoder and calldata mutation tests |
| TM-009 | fee bypass/spike | PASS locally / PLANNED protected | P2-03 priority/max-fee, ceiling and freshness escalation tests |
| TM-010 | stale/downgraded policy | PASS locally / PLANNED pre-sign | fence + binding; Phase 3 |
| TM-011 | expired approval | PASS locally | WP-08 |
| TM-012 | revocation/pause race | PASS locally / PLANNED pre-sign | WP-04/10 then Phase 3 |
| TM-013 | permit/unlimited/signature abuse | PLANNED | P2-02/P2-04/Phase 4 |
| TM-014 | delegatecall/multicall/proxy | PASS locally / PLANNED protected | P2-02 unknown-selector and exact-length decoder tests |
| TM-015 | token metadata manipulation | PASS for P2-01 fixture / PLANNED E2E | deployment metadata and runtime code-hash checks; P2-02 |
| TM-016 | RPC disagreement | PASS locally / PLANNED protected | P2-03 chain/fixture/block/fee disagreement fail-closed tests |
| TM-017 | re-simulation divergence | PASS locally / PLANNED protected | P2-03 executable mutation and bounded freshness tests |
| TM-018 | signed-unbroadcast ambiguity | PASS only as local disputed-state primitive / PLANNED real local signer | P2-04/P2-06 then Phase 3 |
| TM-019 | broadcast persistence timeout | PASS local recovery primitive / PLANNED adapter integration | P2-05/P2-06 then Phase 3 |
| TM-020 | revert/reorg/receipt confusion | PLANNED | P2-05/P2-06 |
| TM-021 | reservation expiry race | PASS core lifecycle / PLANNED E2E | Phase 3 |
| TM-022 | malicious/replayed webhook | NOT APPLICABLE to current local MVP surface | revisit if webhook adapter added |
| TM-023 | audit tampering/omission | PASS locally / PLANNED E2E | DB guards then Phase 5 |
| TM-024 | secret output/log exposure | PASS for P2-01 deployment/fixture output / PLANNED signer redaction | temporary mode-0600 key file; no key in output or fixture; P2-04/P2-06/Phase 5 |
| TM-025 | SQL/command injection | PASS for parameterized core paths / PLANNED interface adversarial | Phase 4/5 |
| TM-026 | owner session/CSRF | PASS for ADR-0008 local signed-decision boundary / PLANNED browser session | Phase 4 |
| TM-027 | interface bypass | PLANNED | Phase 4 |
| TM-028 | enforcement overclaim | PLANNED | P2-04 adapter conformance |
| TM-029 | migration/data loss | PASS for forward/checksum/corrective path / PLANNED backup drill | later hardening |
| TM-030 | dependency/supply chain | PASS for lock/audit/action pins / monitored | ongoing; `viem` lock/audit at P2-02 |
| TM-031 | constructor self-verification | PASS locally / PLANNED protected | P2-02 `viem` encoder + independent strict parser + 128 calldata mutation runs |
| TM-032 | unbound signer transaction fields | PASS locally / PLANNED signer proof | P2-02 v2 schema/hash binds exact fields; P2-04 must prove signer exactness |
| TM-033 | response-loss false failure/release | PASS focused local / PLANNED protected fault compatibility | exact-byte broadcast 12/12; DB release/recovery fence and crash-resume orchestration |
| TM-034 | receipt/cross-operation substitution | PASS focused local / PLANNED protected | P2-05C entry-point suite covers tx/receipt/log, operation/reservation/fixture, auth and legacy-evidence mismatches |
| TM-035 | local-chain reset confusion | PASS for P2-01 fixture / PASS locally P2-03 / PLANNED protected | genesis/fixture/deployment/code fingerprints plus P2-03 fixture-bound simulation evidence |

## Phase-2 implementation matrix

The packet-level `requirement -> test -> suite -> packet -> evidence` matrix, including inherited S0/S1 gates, is maintained in `docs/plans/PHASE-2.md`. ADR-0015 is accepted and P2-02 is no longer blocked on product-owner architecture approval.
| P2-01A | pinned fake ERC-20 toolchain and contract | PASS | `npm run contracts:test` — 10/10 |
| P2-01B | checkout-bound fixture, unique instance identity and local-chain boundary | PASS | Protected CI `33189082028` on `25e8147f`; Forge 10/10; chain 9/9 including reset → redeploy stale-instance proof |
| P2-02A | additive envelope v2 and hash dispatch | PASS locally / PLANNED protected | `npx vitest run packages/schemas/test/envelope-v2.test.ts`; 60 tests; v1 regression suite 47 tests; exact v2 hash vector |
| P2-02BCD | static transfer construction, independent decoder and verifier | PASS locally / PLANNED protected | `npx vitest run packages/transaction-pipeline/test/transfer-core.test.ts`; 27 tests including 128 calldata mutation runs |
| P2-02 integration | combined P2-02 local review gate | PASS locally / PLANNED protected | `npm ci`; `npm run check`; audit 0 vulnerabilities; Forge 10/10; DB 71/71; concurrency 18/18; invariants 7/7; focused P2-02 87 tests |
| P2-03 | canonical simulation, exact executable resolution, fee enforcement and freshness | PASS locally / PLANNED protected | 20 focused unit tests; 1 focused loopback chain test; 21 repository + 225 package tests; Forge 10/10; DB 71/71; concurrency 18/18; invariants 7/7; audit 0 vulnerabilities. Default all-chain invocation also hit the inherited 5-second P2-01 fixture reset-test timeout; no skip or protected claim. |

### P2-05A/B/C integration checkpoint

| Packet | Status | Evidence at exact code head `c0c4949590fbd7992f06537dc3cb93dd841a7936` |
| --- | --- | --- |
| P2-02/P2-03/P2-04 | PASS locally and integrated | `npm run check`: 21 repository + 287 Vitest; envelope 68/68; transaction-pipeline 61/61; signer/adapter 36/36 |
| P2-05A | PASS locally and integrated | Broadcast suite 7/7; expected hash and STARTED attempt durable before send; uncertainty retained |
| P2-05B | PASS locally and integrated | Chain-evidence suite included in pipeline gate; transaction/receipt/block/Transfer and fixture binding are independently checked |
| P2-05C | PASS locally and integrated | Reconciliation/recovery suite 10/10; DB gate 82/82; verified revert releases zero token spend while native fees remain separate |
| Combined local gates | PASS | Forge 10/10; concurrency 18/18; invariants 7/7; chain 10/10; audit 0 high vulnerabilities |
| Protected remote | PASS | CI run `33299665297`; Secret Scan run `33299665282`; both tested exact head above |
| P2-05D | PENDING | Clean vertical-slice E2E is not part of this recovery checkpoint |
| P2-06A | SEPARATE | Historical compatibility branch fault gate 59/59; not merged into the product integration branch |

The inherited Vitest exit-135 event was not reproduced after integration. The two reported envelope-v2 failures were not reproduced on the clean packet history; the weakened user-edited test state is preserved separately on `preserve/phase2-dirty-state` and is not part of this checkpoint. Gate S2 remains **OPEN / NOT PASSED**.

### P2-05 external-review remediation checkpoint

| Scope | Current evidence |
| --- | --- |
| Broadcast | `adapters/local-anvil/test/broadcast-core.test.ts` — 12/12 focused local: canonical signed-byte hash binding, mutation/unrelated/malformed rejection before sender, matching acceptance, CONFLICT, UNKNOWN and conservative stale-nonce classification |
| Reconciliation orchestration | `tests/db/execution-evidence.test.ts` — 28/28 focused local through `reconcileLocalChainEvidence()`, including exact success/revert, mismatch/cross-binding/auth cases, durable release fence, duplicate/concurrent retry and deterministic post-resolution/post-effect crash recovery |
| Migration | `0023_p205_broadcast_safety.sql` is additive and forward-only; prior migrations are unchanged. It adds CONFLICT, exact legacy-evidence binding, signed-lifecycle canonical authorization, and the send-attempt release fence |
| Full local gates | PASS — `npm ci`; `npm run check` 21 repository + 292 Vitest; audit 0 vulnerabilities; Forge 10/10; DB 100/100; concurrency 18/18; invariants 7/7; chain 10/10 |
| P2-06A compatibility | PASS on a disposable, unmerged compatibility branch — `npm run test:fault` 64/64, including deterministic forward-then-drop coverage |
| Protected CI / Secret Scan | PENDING exact final head |
| Scope boundary | P2-05D not implemented; P2-06B/C not started; S2 not accepted |
