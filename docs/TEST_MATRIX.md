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

## Historical Phase-2 local fixture evidence

This is historical packet evidence only. It did not promote Gate S2, which also required
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
| S2-01 | Clean-Anvil full transaction journeys | PASS | P2-05D clean local Anvil fake-ERC20 journey and final protected candidate |
| S2-02 | Complete trace/audit E2E | PASS | P2-05D durable correlated trace/audit from construction through reconciliation |
| S2-03 | Execution-boundary recovery | PASS | P2-06B/C UNKNOWN retention, response loss, restart, duplicate safety, revert, substitution and exactly-once reconciliation |

**Gate S1: PASS / ACCEPTED. S2-01: PASS. S2-02: PASS. S2-03: PASS. S2 requirement evidence: PASS. External S2 acceptance: PASS / ACCEPTED in review `5126373971`. Gate S2: PASS / ACCEPTED.**

**Phase 2 / WS-004: COMPLETE / ACCEPTED for the governing local MVP boundary. Phase 3 is NOT OPENED.**

ADR-0015 is accepted architectural authority, not test evidence. It removes the previous P2-02 architecture blocker but no Phase-2 threat/product row becomes PASS until the named implementation test exists and protected current-head evidence is recorded.

## Product requirements

| ID | Requirement | Status | Evidence / next phase |
| --- | --- | --- | --- |
| PR-001 | Clean clone installs/checks | PASS | protected CI/local bootstrap |
| PR-002 | Anvil 31337 and fake assets only | PASS | local runtime guard + P2-01 fixed-supply MockERC20 transfer gate |
| PR-003 | owner/agent/wallet/policy fixture | PASS | DB fixtures |
| PR-004 | read-only/review/autonomous modes | PLANNED | Phase 2-4 integration |
| PR-005 | budget under concurrency | PASS | S1-01 |
| PR-006 | chain/asset/recipient/action restrictions | PASS / ACCEPTED for Phase-2 local boundary | local Anvil/fake-ERC20 transfer path; production/provider scope excluded |
| PR-007 | atomic reservation before authorization | PASS | WS-003 |
| PR-008 | retry/idempotency cannot duplicate spend | PASS / ACCEPTED for Phase-2 local boundary | P2-05/P2-06 durable broadcast/recovery and exactly-once reconciliation; Phase-3 integrated controls remain separate |
| PR-009 | intent constructs transaction | PASS / ACCEPTED for Phase-2 local boundary | P2-02 integration: `packages/transaction-pipeline/test/transfer-core.test.ts` |
| PR-010 | independent decode/verification | PASS / ACCEPTED for Phase-2 local boundary | P2-02 independent decoder and static verifier mutation tests |
| PR-011 | state-changing operations simulated | PASS / ACCEPTED for Phase-2 local boundary | P2-03 unit + loopback chain simulation |
| PR-012 | immutable envelope after reservation | PASS / ACCEPTED for Phase-2 local boundary | WS-002 approval binding; P2-02 exact signed-field proof |
| PR-013 | approval envelope-bound and one-time | PASS locally | WP-07/08; E2E Phase 3 |
| PR-014 | owner/signer key outside agent process | PASS / ACCEPTED for Phase-2 local boundary | P2-04 IDs-only local signer and P2-06 leakage checks; production custody excluded |
| PR-015 | revocation/pause before signing | PASS for S1 control plane / PLANNED at signer boundary | Phase 3 |
| PR-016 | native fee ceiling | PASS / ACCEPTED for Phase-2 local boundary | P2-03/P2-06 integer max-cost, native-balance and fee-escalation tests |
| PR-017 | MCP/CLI/dashboard share core | PLANNED | Phase 4 |
| PR-018 | no raw signing surface in interfaces | PLANNED | P2-04 local adapter + Phase 4 public interfaces |
| PR-019 | lifecycle telemetry correlation | PLANNED | Phase 5 |
| PR-020 | append-only correlated audit | PASS / ACCEPTED for Phase-2 local boundary | P2-05D durable trace/audit E2E; Phase-5 telemetry remains separate |
| PR-021 | adapter manifest/conformance | PLANNED | P2-04 |
| PR-022 | invalid transitions rejected | PASS | WS-002 property proof |
| PR-023 | failures/retries reconcile safely | PASS / ACCEPTED for Phase-2 local boundary | P2-05/P2-06 local chain recovery; Phase-3 integrated controls remain separate |
| PR-024 | documentation matches behavior | PASS for current S0/S1 state / PLANNED continuously | current gate/ADR reconciliation; re-evaluate every packet |
| PR-025 | no unresolved critical/high security findings | BLOCKED | final MVP hardening, not Phase-1 gate |
| PR-026 | product-owner MVP sign-off | BLOCKED | MVP not complete |

## Threat/adversarial requirements

| ID | Threat | Status | Evidence / next phase |
| --- | --- | --- | --- |
| TM-001 | total overspend | PASS | ledger invariant |
| TM-002 | concurrent overspend | PASS | protected 32×4 deterministic proof |
| TM-003 | idempotency conflict | PASS | DB retry/conflict |
| TM-004 | duplicate broadcast/evidence | PASS / ACCEPTED for Phase-2 local boundary | P2-06 durable broadcast/recovery and exactly-once evidence |
| TM-005 | approval replay | PASS locally | WP-07/08 |
| TM-006 | chain substitution/public RPC | PASS / ACCEPTED for Phase-2 local boundary | loopback/31337 guards; P2-03/P2-04/P2-06; no public-network claim |
| TM-007 | recipient/amount/asset substitution | PASS / ACCEPTED for Phase-2 local boundary | P2-02/P2-06 static verifier and mutation tests |
| TM-008 | calldata/extra-call substitution | PASS / ACCEPTED for Phase-2 local boundary | P2-02/P2-06 strict 68-byte decoder and calldata mutation tests |
| TM-009 | fee bypass/spike | PASS / ACCEPTED for Phase-2 local boundary | P2-03/P2-06 priority/max-fee, ceiling and freshness escalation tests |
| TM-010 | stale/downgraded policy | PASS locally / PLANNED pre-sign | fence + binding; Phase 3 |
| TM-011 | expired approval | PASS locally | WP-08 |
| TM-012 | revocation/pause race | PASS locally / PLANNED pre-sign | WP-04/10 then Phase 3 |
| TM-013 | permit/unlimited/signature abuse | PLANNED | P2-02/P2-04/Phase 4 |
| TM-014 | delegatecall/multicall/proxy | PASS / ACCEPTED for Phase-2 local boundary | P2-02/P2-06 unknown-selector and exact-length decoder tests |
| TM-015 | token metadata manipulation | PASS for P2-01 fixture / PLANNED E2E | deployment metadata and runtime code-hash checks; P2-02 |
| TM-016 | RPC disagreement | PASS / ACCEPTED for Phase-2 local boundary | P2-03/P2-06 chain/fixture/block/fee disagreement fail-closed tests; no Byzantine-RPC claim |
| TM-017 | re-simulation divergence | PASS / ACCEPTED for Phase-2 local boundary | P2-03/P2-06 executable mutation and bounded freshness tests |
| TM-018 | signed-unbroadcast ambiguity | PASS / ACCEPTED for Phase-2 local boundary | P2-04/P2-06 IDs-only signer, UNKNOWN/DISPUTED retention and no-resign proof |
| TM-019 | broadcast persistence timeout | PASS / ACCEPTED for Phase-2 local boundary | P2-05/P2-06 durable attempt and recovery proof; adapter integration remains local-only |
| TM-020 | revert/reorg/receipt confusion | PASS / ACCEPTED for Phase-2 local boundary | P2-05/P2-06 canonical block, transaction, receipt and Transfer-log matching; no production-finality claim |
| TM-021 | reservation expiry race | PASS core lifecycle / PLANNED E2E | Phase 3 |
| TM-022 | malicious/replayed webhook | NOT APPLICABLE to current local MVP surface | revisit if webhook adapter added |
| TM-023 | audit tampering/omission | PASS / ACCEPTED for Phase-2 local boundary | DB guards and P2-05D/P2-06 correlated audit evidence; integrated telemetry remains Phase 5 |
| TM-024 | secret output/log exposure | PASS / ACCEPTED for Phase-2 local boundary | mode-0600 state, IDs-only signer and P2-06 redaction/leakage checks |
| TM-025 | SQL/command injection | PASS for parameterized core paths / PLANNED interface adversarial | Phase 4/5 |
| TM-026 | owner session/CSRF | PASS for ADR-0008 local signed-decision boundary / PLANNED browser session | Phase 4 |
| TM-027 | interface bypass | PLANNED | Phase 4 |
| TM-028 | enforcement overclaim | PLANNED | P2-04 adapter conformance |
| TM-029 | migration/data loss | PASS for forward/checksum/corrective path / PLANNED backup drill | later hardening |
| TM-030 | dependency/supply chain | PASS for lock/audit/action pins / monitored | ongoing; `viem` lock/audit at P2-02 |
| TM-031 | constructor self-verification | PASS / ACCEPTED for Phase-2 local boundary | P2-02 `viem` encoder + independent strict parser + 128 calldata mutation runs |
| TM-032 | unbound signer transaction fields | PASS / ACCEPTED for Phase-2 local boundary | P2-02 v2 schema/hash plus P2-04 signer exactness and P2-06 mutation proof |
| TM-033 | response-loss false failure/release | PASS / ACCEPTED for Phase-2 local boundary | exact-byte broadcast, DB release/recovery fence and crash-resume orchestration |
| TM-034 | receipt/cross-operation substitution | PASS / ACCEPTED for Phase-2 local boundary | P2-05C/P2-06 transaction, receipt, log, operation, reservation, fixture, auth and legacy-evidence mismatch coverage |
| TM-035 | local-chain reset confusion | PASS / ACCEPTED for Phase-2 local boundary | genesis/fixture/deployment/code fingerprints plus P2-03/P2-06 fixture-bound evidence |

## Phase-2 implementation matrix

The packet-level `requirement -> test -> suite -> packet -> evidence` matrix, including inherited S0/S1 gates, is maintained in `docs/plans/PHASE-2.md`. ADR-0015 is accepted and P2-02 is no longer blocked on product-owner architecture approval.
| P2-01A | pinned fake ERC-20 toolchain and contract | PASS | `npm run contracts:test` — 10/10 |
| P2-01B | checkout-bound fixture, unique instance identity and local-chain boundary | PASS | Protected CI `33189082028` on `25e8147f`; Forge 10/10; chain 9/9 including reset → redeploy stale-instance proof |
| P2-02A | additive envelope v2 and hash dispatch | PASS / ACCEPTED for Phase-2 local boundary | `npx vitest run packages/schemas/test/envelope-v2.test.ts`; exact v2 hash vector and v1 regression coverage |
| P2-02BCD | static transfer construction, independent decoder and verifier | PASS / ACCEPTED for Phase-2 local boundary | `npx vitest run packages/transaction-pipeline/test/transfer-core.test.ts`; calldata mutation coverage |
| P2-02 integration | combined P2-02 local review gate | PASS / ACCEPTED for Phase-2 local boundary | `npm run check`; audit 0 vulnerabilities; Forge/DB/concurrency/invariant and focused P2-02 coverage |
| P2-03 | canonical simulation, exact executable resolution, fee enforcement and freshness | PASS / ACCEPTED for Phase-2 local boundary | focused unit/loopback chain evidence plus final protected Phase-2 gate; production/public-network scope excluded |

### P2-05A/B/C integration checkpoint (historical)

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

### P2-05D architecture gap proposal (historical)

| Scope | Status | Required evidence before status may advance |
| --- | --- | --- |
| ADR-0016 canonical autonomous authorization | PROPOSED / NOT IMPLEMENTED | Migration-upgrade, owner-regression, autonomous writer, direct-forgery, invalidation, and deterministic concurrency suites |
| ADR-0017 signer-local execution handoff | PROPOSED / NOT IMPLEMENTED | Same-child sign/broadcast, exact hash, crash barriers, rematerialization, no-resign state fences, and output/DB/audit/key leakage suites |
| PRE-A/PRE-B integration | BLOCKED ON PRODUCT-OWNER DECISION | Combined authorization/signer/broadcast security review and all inherited gates |
| P2-05D | PENDING at this historical checkpoint | Fresh clean vertical slice through production transition writers; no protected-state seeding |
| Gate S2 | OPEN / NOT PASSED | Full Phase-2 closeout and protected exact-SHA evidence |

The inherited Vitest exit-135 event was not reproduced after integration. The two reported envelope-v2 failures were not reproduced on the clean packet history; the weakened user-edited test state is preserved separately on `preserve/phase2-dirty-state` and is not part of this checkpoint. Gate S2 remains **OPEN / NOT PASSED**.

### P2-05 external-review remediation checkpoint

| Scope | Current evidence |
| --- | --- |
| Broadcast | `adapters/local-anvil/test/broadcast-core.test.ts` — 12/12 focused local: canonical signed-byte hash binding, mutation/unrelated/malformed rejection before sender, matching acceptance, CONFLICT, UNKNOWN and conservative stale-nonce classification |
| Reconciliation orchestration and broadcast-fence races | `tests/db/execution-evidence.test.ts` — 32/32 focused local, including 4/4 deterministic real-store PostgreSQL cases for STARTED-first, RELEASED-first, EXPIRED-first and repeated STARTED idempotency; the suite retains exact reconciliation success/revert, mismatch/cross-binding/auth, duplicate/concurrent retry and post-resolution/post-effect crash recovery coverage |
| Migration | `0023_p205_broadcast_safety.sql` is additive and forward-only; prior migrations are unchanged. It adds CONFLICT, exact legacy-evidence binding, signed-lifecycle canonical authorization, and the send-attempt release fence |
| Full local gates | PASS — `npm ci`; `npm run check` 21 repository + 292 Vitest; audit 0 vulnerabilities; Forge 10/10; DB 104/104; concurrency 18/18; invariants 7/7; chain 10/10 |
| P2-06A compatibility | PASS on a disposable, unmerged compatibility branch — `npm run test:fault` 64/64, including deterministic forward-then-drop coverage |
| Protected CI / Secret Scan | PENDING exact final head |
| Scope boundary | P2-05D not implemented at this historical checkpoint; P2-06B/C not started; S2 not accepted |

### P2-05D final integration checkpoint (historical pre-acceptance checkpoint)

Earlier remediation checkpoint (not the final accepted head):
`a45c32d46330230614c8a72b44c0941dd0cf1850`.
The full final branch SHA is the documentation handoff commit reported with
the protected checks. All chain evidence below is local-only Anvil
`eip155:31337`; S2 remains **OPEN / NOT PASSED**.

| Scope | Result |
| --- | --- |
| PRE-A/PRE-B integration | PASS — PRE-A `c1f6ab9167c9960e8ef1f822f7351a3ad04a70b6`; PRE-B commits `d251726` and `84e85007864c1cbf7326288e4651048cebf493f3`; signer consumes `OWNER_APPROVAL` and `AUTONOMOUS_POLICY` through one exact path |
| Autonomous authorization | PASS — `tests/db/autonomous-authorization.test.ts` 15/15; production `authorizeAutonomous` only accepts persisted `ALLOW_AUTONOMOUS` and current common controls |
| Owner approval regression | PASS — `tests/db/approval.test.ts` 26/26 (25 historical + owner fence-snapshot regression); genuine approval evidence remains required |
| Migration | PASS — fresh 0023 → 0024 database gate; `npm run test:db` 122/122; migrations 0001–0023 unchanged |
| Signer / keys / execution handoff | PASS — signer-core 26/26, signer-keys 2/2, execution-core 18/18, frozen vector 1/1 |
| Broadcaster | PASS — `broadcast-core.test.ts` 12/12; exact hash binding, STARTED-before-send, UNKNOWN/CONFLICT handling |
| Chain evidence | PASS — `chain-evidence.test.ts` 20/20; transaction/receipt/block/standard Transfer matching |
| Reconciliation | PASS — included in DB 122/122 and the clean E2E; authenticated lease-fenced exactly-once effect |
| P2-05D E2E | PASS — `tests/chain/p2-05d-e2e.test.ts` 1/1; no protected-state lifecycle/evidence seeding |
| Database / concurrency / invariants / chain | PASS — 122/122, 18/18, 7/7, 10/10 |
| Forge / complete check / audit | PASS — 10/10, 21 repository + 314 Vitest, 0 high vulnerabilities |
| Protected remediation evidence | PASS — historical checkpoint CI `33441013501` and Secret Scan `33441013543`; final P2-05D acceptance is recorded in the current durable-audit packet below |
| Scope | Historical checkpoint only; final P2-05D acceptance and the later P2-06 packets are recorded below; no S2 acceptance claim |

Clean E2E identity and economic proof: fixture instance
`33c6581c-6af0-489a-a1e9-0e171e022281`; operation `op_p205d_e2e`; reservation
`res_p205d_e2e`; envelope `env_p205d_e2e_1` /
`0xf4155e8dfe39d494c5c1bba0c745494baceb3a9ec44fac711b421579dfdecc9f`;
decision `decision_p205d_e2e` = `ALLOW_AUTONOMOUS` /
`0x25e2f8f9e04eac2f97c20067d13aa79a9c892c9e8ec0b5199a50c8640729be76`;
authorization `auth_p205d_e2e` = `AUTONOMOUS_POLICY`; simulation
`simulation:op_p205d_e2e` /
`0xfc8103e4da0c49245dd307e74cf6ebf90dfbc26aa38b4933c877799c9d8bc09a`;
signed transaction `signed:op_p205d_e2e:1`; expected hash
`0x6e49129c1ec079bca131564a7f79d7c99f11ada25ad80baabce148ea62569c55`;
attempt `attempt:op_p205d_e2e:1` = `ACCEPTED`; receipt block `2`;
recovery outcome `CONFIRMED`; effect `effect:attempt:op_p205d_e2e:1`.
Token moved `123456` atomic units exactly (sender
`1000000000000 -> 999999876544`, recipient `0 -> 123456`). Native balance
was `9999999696272999696273` and became `9999999600017614894520`; gas used
`51267` at effective gas price `1877531059`, for verified native fee
`96255384801753`. Ledger ended `allocated=1000000`, `available=876544`,
`reserved=0`, `finalized_spend=123456`. Raw signed bytes and the signer key
were absent from the persisted/output leakage scan.

### P2-05D durable-audit closeout (current)

Implementation commit: `c8f7309` (`fix: persist p2-05d preparation audit evidence`).
Local result: P2-05D E2E `1/1`; DB `124/124` (including operation, simulation,
and final-policy audit collision tests); `npm run check` `21 repository + 314
Vitest`; Forge `10/10`; chain `10/10`; concurrency `18/18`; invariants `7/7`;
`npm audit --audit-level=high` `0` vulnerabilities.

The successful E2E durable semantic sequence is:

`transaction.constructed` → `transaction.decoded` → `transaction.verified` →
`transaction.simulated` → `policy.evaluated` →
`budget.reservation.created` → `budget.reservation.authorized` →
`signing.started` → `transaction.signed` → `budget.reservation.broadcast` →
`budget.reservation.evidence.verified` → `execution.recovery.claimed` →
`budget.reservation.finalized` → `execution.recovery.resolved`.

The exact successful run persisted simulation
`simulation:op_p205d_e2e` / evidence hash
`0x9364237ed77d9af99fc72eb4d194ec50751c7055109784261cc276c02bda2686`, final
policy decision `decision_p205d_e2e` / hash
`0x7175115f9aa31ce1fd30089ccc4918376389d8485a06013fe388579fe8ec833b`,
envelope hash
`0x4de1586ba510db8cb7d2c35f1f61361492a16c02fc3c3becd67d5280b2b846d0`, and
authorization `auth_p205d_e2e` with the same policy hash. Signed, broadcast,
verified transaction, receipt, and reconciled transaction hashes all equal
`0x6e49129c1ec079bca131564a7f79d7c99f11ada25ad80baabce148ea62569c55`.
All rows are bound to operation `op_p205d_e2e`; audit payloads contain hashes
and identifiers only, with no raw signed bytes or private key.

### P2-06A integration checkpoint (historical)

Canonical branch: `phase-2/ws-004-local-erc20`; canonical PR: #5; P2-05:
ACCEPTED. Auxiliary PR #8 and PR #12: merged/closed. P2-06A is integrated on
this checkpoint only. P2-06B, P2-06C and P2-06D are pending. S2 remains OPEN /
NOT PASSED.

| Check | Result |
| --- | --- |
| `npm run test:fault` | PASS — 20 focused fault-proxy tests; full fault gate 89 tests across 7 adapter files |
| Fault modes | PASS — passthrough, unavailable-before-send, explicit rejection, forward-then-drop, wrong hash, mutated transaction, mutated receipt, withhold/release, crash-before-send, crash-after-forward |
| Boundary/redaction | PASS — non-loopback/public/credentialed HTTPS upstreams rejected; current-runtime mismatch rejected; matching loopback runtime accepted; raw send bytes redacted |
| Protected CI / Secret Scan | Pending external review of pushed integration SHA |

P2-06A is test-only infrastructure. P2-06B/C/D are pending and no S2 claim is
made.

### P2-06B/C integration checkpoint (historical)

| Scope | Result |
| --- | --- |
| Canonical starting point | `phase-2/ws-004-local-erc20` at `b27202edac48cd183ec1bac8856b905447d91f49` |
| P2-06B | IMPLEMENTED / INTEGRATED / EXTERNALLY ACCEPTED — complete range `eb8037b` → `95d339a` → `a6a2ff1`; no product or ADR redesign |
| P2-06C | IMPLEMENTED / INTEGRATED / EXTERNALLY ACCEPTED — accepted head `e0bb273d9000eaf6150a5e200cc6ab0e65cd1dd6` |
| P2-06A | INTEGRATED / ACCEPTED on canonical base; loopback-only proxy and redaction preserved |
| Combined fault gate | PASS — `npm run test:fault`: 9 files, 133/133 tests; P2-06A + P2-06B coverage |
| Combined adversarial gate | PASS — `npm run test:adversarial`: 7 files, 169/169 tests; P2-06C plus inherited authority/reconciliation coverage |
| Inherited gates | PASS — check 21 repository + 344 Vitest; Forge 10/10; chain 10/10; E2E 1/1; DB 126/126; concurrency 18/18; invariants 7/7 |
| Dependency audit | PASS — `npm audit --audit-level=high`: 0 vulnerabilities |
| Conflict resolution | None; B then C cherry-picked cleanly with four preserved commits |
| Scope | Historical pre-acceptance checkpoint: P2-06D evidence ready; local fake-money Anvil `eip155:31337` only; S2 requirement evidence PASS, external acceptance pending, Gate S2 open / not passed |

The inherited protected CI and Secret Scan passed the integrated B/C head;
P2-06D added the fresh clean-room and protected exact-head closeout. The
pre-acceptance wording in this historical checkpoint is superseded by the final
acceptance record below.

### P2-06D clean-room closeout evidence package

Closeout branch: `work/p2-06d-pre-s2-closeout`.
Canonical starting SHA: `7f3be19b75b798739e002ff15ece9250cfecd04b`.
Every accepted packet SHA below is reachable from that canonical head; no
earlier accepted packet was dropped. The final pushed candidate SHA and
protected run IDs are reported in the final handoff for this evidence PR.

| Packet | Accepted implementation/evidence SHA | Focused suite and current count | External review | Residual limitation |
| --- | --- | --- | --- | --- |
| P2-01 | `25e8147f7439af5722dafe092a33dd1351c15280` | Forge `10/10`; fixture chain `9/9` | Accepted/integrated | Disposable Anvil/mock token only |
| P2-02 | `9d58f47e6a96ace77fe04059b8d8066fe6a939af` | envelope/transfer focused `87/87` | Accepted/integrated | Static transfer scope only |
| P2-03 | `6a59b392c275fc6dd81f5c55fd5a0efa1f67a812` | simulation unit `15/15`; chain simulation `1/1` | Accepted/integrated | Local canonical simulation only |
| P2-04 | `0e00f212711c07aae363c28245d2ee453f8d84c2` | signer/capability/key focused `38/38` | Accepted/integrated | Restricted local reference signer only |
| P2-05A | `28258696b40da1ae392928d9603d63231c6c8347` | broadcast core `12/12` | Accepted/integrated | Local broadcast boundary only |
| P2-05B | `800b8650a0b621dbb1e9c94864bcd7e147b70066` | chain evidence `20/20` | Accepted/integrated | One included local Anvil block |
| P2-05C | `052d10f5ff798beb1b82819d14c23a5a7943cbb6` | DB execution evidence included in `126/126` | Accepted/integrated | Phase-3 integrated controls excluded |
| P2-05D | implementation `c8f730916c67bcec361d3cc376c0d0602e54bb7e`; final accepted head `13359a513d9b9b2569b763a294755ed23f7a00a8` (PR #12) | clean production-writer E2E `1/1`; DB `126/126` | Externally accepted; CI `34015801865`; Secret Scan `34015801786` | Local autonomous-within-policy path only |
| P2-06A | final accepted head `8590e9c747afd4a30e6fef6b5487f3422268497d` (PR #13); historical integration commit `1841e2ba9cdecc7d8852a7f1434c3c4d9849aa6f` | fault proxy `20/20` | Externally accepted; review `5124743140`; CI `34021596350`; Secret Scan `34021596342` | Loopback upstream allowlist only |
| P2-06B | `a6a2ff1734b4019e5b001e6d283de38639e05def` | broadcast/crash matrix `10/10`; combined fault `133/133` | Externally accepted/integrated | Local fault substitution only |
| P2-06C | `e0bb273d9000eaf6150a5e200cc6ab0e65cd1dd6` | substitution matrix `41/41`; combined adversarial `169/169` | Externally accepted/integrated | Local evidence; no Phase-3 claim |

#### Protected P2-06D implementation/evidence provenance

The protected P2-06D implementation/evidence head is
`6efdfd7c91b437da94b8b0e84e929f01b7aa4f46`.

- Protected CI: `34042660826` — PASS.
- Protected Secret Scan: `34042660842` — PASS.
- CI explicitly passed check, high-severity dependency audit, contracts,
  fixture, chain, DB, concurrency, invariants, P2-05D E2E, P2-06 fault,
  P2-06 adversarial, generated-state/quiet-signer checks and cleanup.
- P2-06 fault: `133/133`; P2-06 adversarial: `169/169`.

The documentation-only remediation created the final docs/provenance review
head below. Its checks are distinct from the protected implementation/evidence
head above.

#### Final S2 acceptance record

- Implementation/evidence head: `6efdfd7c91b437da94b8b0e84e929f01b7aa4f46`; CI `34042660826` PASS; Secret Scan `34042660842` PASS.
- Final docs/provenance review head: `d9155c07ace6e143ad514c0cac4b5a8c2161a56c`; CI `34047855933` PASS; Secret Scan `34047855929` PASS.
- External S2 acceptance: review `5126373971` — PASS / ACCEPTED. This is a documented COMMENT review under the solo-maintainer model, not a separate GitHub-account approval; R-019 is preserved.
- Canonical PR #17 merge: `34e0b53af07abff20fc36a737c17d6b0107e57bc`.

Gate S2: **PASS / ACCEPTED**.

Phase 2 / WS-004: **PASS / ACCEPTED** for the governing local MVP boundary.

P2-06D: **COMPLETE / ACCEPTED / INTEGRATED**. Phase 3: **NOT OPENED**.

#### Fresh exact clean-room counts

| Gate | Result |
| --- | --- |
| `npm ci` | PASS — 176 packages added; 186 audited |
| `npm run check` | PASS — 21 repository tests + 344 Vitest; docs/repository checks pass |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| `npm run contracts:test` | PASS — Forge 10/10 |
| `npm run test:chain` | PASS — 10/10 |
| `npm run test:e2e` | PASS — 1/1 |
| `npm run test:db` | PASS — 126/126 |
| `npm run test:concurrency` | PASS — 18/18 |
| `npm run test:invariants` | PASS — 7/7; configured property run `512` |
| `npm run test:fault` | PASS — 9 files, 133/133 |
| `npm run test:adversarial` | PASS — 7 files, 169/169 |
| runtime/fixture/cleanup | PASS — loopback Anvil `eip155:31337`, disposable PostgreSQL, `dev:down` cleanup |

#### S2 proof map

| Requirement | Suite/evidence | Exact result |
| --- | --- | --- |
| Clean intent → RECONCILED journey | `tests/chain/p2-05d-e2e.test.ts` plus DB/audit assertions | `1/1`; token delta `123456` atomic units; sender `1000000000000 → 999999876544`; recipient `0 → 123456`; native fee `96255384801753`; ledger `available=876544, reserved=0, finalized_spend=123456` |
| Durable trace/audit | P2-05D E2E and `tests/db/execution-evidence.test.ts` | construction, decode, verify, simulation, final policy, reservation, authorization, signing, broadcast, verification, recovery and reconciliation correlated; no raw signed bytes/key |
| Forward-then-drop / UNKNOWN retention | P2-06B crash matrix and combined fault gate | `10/10`; `133/133`; no release or re-sign |
| Crash/restart, duplicate retry, verified revert, no duplicate spend | P2-06B/C plus DB/recovery gates | `126/126`, `18/18`, `169/169`; exactly-once effect assertions pass |
| Transaction/envelope mutation fail closed | P2-06C substitution matrix, envelope/transfer and simulation suites | `41/41`, `87/87`, `15/15` |
| Fixture/block/receipt/log substitution fail closed | chain evidence plus P2-06C | `20/20`, `41/41` |
| Alternate signing fails closed | signer/core/key and adversarial suites | `38/38`, `169/169` |
| Duplicate/concurrent reconciliation exactly once | DB execution evidence and adversarial suite | `126/126`, `169/169` |

#### Security review at the closeout checkpoint

- `npm ci` and the committed lockfile are consistent; audit is `0` high/critical vulnerabilities.
- All workflow actions remain commit-pinned; this packet adds no action, image, dependency, migration, RPC, or wallet material.
- Executable network paths remain loopback/Anvil-only; fault proxy tests reject public, non-loopback, credentialed, and wrong-runtime upstreams.
- Signer state remains mode `0600`; generated state and quiet-signer checks are protected workflow steps. Raw signed bytes and private keys are not persisted, logged, or audited.
- Migrations are forward-only; historical migrations are unchanged by this packet. No critical/high Phase-2 finding is open from the local audit or focused security matrices.
- Local gitleaks was unavailable in this environment; protected remote Secret Scan passed on the exact final candidate, with its run ID reported in the final handoff.

P2-06D is complete / accepted / integrated. S2 requirement evidence is PASS;
external S2 acceptance is PASS / ACCEPTED. Phase 2 / WS-004 is COMPLETE /
ACCEPTED for the governing local MVP boundary. Gate S2 is **PASS / ACCEPTED**;
Phase 3 is NOT OPENED.
