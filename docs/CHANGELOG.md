# Changelog

Owner: lead orchestrator.
Update rule: record user/operator-visible, schema, security, policy, compatibility, dependency, or governance-authority changes in the same integration change.

## Unreleased

### Phase 3 / P3-01 implementation

- Resolved R-033 within the local boundary using one checkout-scoped Anvil
  mutation lease shared by the RPC gateway, lifecycle scripts, and signer.
  The signer acquires the lease before its final freshness RPC and holds it
  through signed-evidence commit, keeping RPC outside DB locks. Anvil has no
  published host port; the allowlisted gateway uses an ephemeral loopback port
  and a dedicated bridge separate from PostgreSQL. Each accepted mutation is
  checkpointed atomically; an unverifiable checkpoint poisons the gateway.
- Live Compose proof mutated a disposable account through the gateway, verified
  the saved state after restart, reset the test chain through the gateway, and
  verified the clean state after another restart. One initial post-reset
  startup failed closed; a guarded retry and a subsequent no-mutation restart
  passed. The chain fixture reset check no longer assumes a fee-dependent
  transaction hash stays fixed; contract address/code and on-chain checks stay
  in place. Local gates pass: check 21 + 361, DB 137, concurrency 18, invariants
  7, signer/execution 52, contracts 10, chain 10, E2E 1, fault 160, and
  adversarial 188. Audit exits 0 at the high-severity threshold with two
  moderate Vitest advisories. MAX review and exact-SHA CI/Secret Scan passed on
  `404837db138ad1bd5c3aceaff6bae67652d5ed01` (runs `35485643373` and
  `35485643343`); P3-01 is cleared.

### Phase 3 / P3-02 implementation

- Added forward-only migration `0027_ws005_signed_unbroadcast_control.sql`.
  Pause/revoke now quarantines signed work with no send attempt as `DISPUTED`,
  retains its reservation, and records an authorization invalidation. A
  committed attempt remains unchanged and auditable; new STARTED work is fenced
  by current controls and invalidations.
- Added forward-only migration `0028_ws005_existing_attempt_recovery.sql` so
  authenticated reconciliation can continue from an exact ACCEPTED/UNKNOWN
  attempt after control changes. Added forward-only migration
  `0029_ws005_rejected_attempt_recovery_guard.sql` so REJECTED no-send attempts
  cannot re-enter broadcast after control invalidation. Added forward-only
  migration `0030_ws005_invalidated_rejected_release_guard.sql` to block direct
  release and expiry for that invalidated attempt. Control request IDs remain
  idempotent across later state changes, and `CONFLICT` attempts can be audited
  by control.
- Generic failed recovery and direct release/expiry cannot clear invalidated
  signed work with no attempt or with a `REJECTED` attempt. Repeated control
  commands are audited once per distinct event ID and exact request replay
  remains idempotent. Local check 21 + 361, DB 145/145 (execution evidence
  53/53), concurrency 18/18, and invariants 7/7 pass. Fresh MAX review
  confidence 0.92 and exact-SHA CI/Secret Scan pass on `b95695c720fd68dd1085e371267a35113a05c816`
  (runs `35493551667` and `35493551719`).

### Phase 3 / P3-03 implementation

- Added forward-only migration `0031_ws005_started_authority_guard.sql` and
  fence-first authority revalidation for the durable `STARTED` send commit.
  The restricted gateway remains the only raw sender, and an existing attempt
  cannot be resent.
- Wired exact local runtime status/recovery evidence to the durable attempt,
  signed transaction, envelope, simulation, fixture, and expected hash. A
  mined transaction on a still-`STARTED` row now reaches the existing
  canonical evidence verifier and authenticated reconciliation path after a
  process crash; control invalidation does not release committed work.
- Candidate `510763b3c9c217f9058b1c9d388ce02d84e6ae9e` passes local check
  (21 repository checks and 363 package tests), DB 150/150, and the P2-05D
  Anvil journey 1/1. Fresh GPT-5.6 Luna MAX review: PASS, 9/10, confidence
  0.90, no findings. Protected exact-SHA CI `35498889238` and Secret Scan
  `35498889228` pass.

### Phase 3 / P3-04 review remediation checkpoint

- This was the local pre-push review checkpoint; exact-head results and
  subsequent P3-05 evidence are recorded below.
- A fresh MAX review found a possible control/authorization lock inversion and
  obsolete generated sign-only child artifacts. Control now locks matching
  authorization evidence before operation/reservation rows; a deterministic
  PostgreSQL barrier proves the order. Removed the obsolete child sources and
  made adapter builds clear stale generated output. Follow-up MAX review passed
  with no blocking findings. Local check passes (21 repository + 363 package
  tests), DB 162/162, and the Phase-3 gate 254/254. Exact-head CI and Secret
  Scan await the remediation push; P3-05/06 remain gated. R-033 is unchanged
  and remains mitigated within the supported local runtime.

### Phase 3 / P3-04 and P3-05 verification checkpoint

- P3-04 candidate `54afbcc9e08374c844d6b7fd784e34fca1856a19` passed exact-head
  protected CI `35787705165` and Secret Scan `35787705289`, clearing the
  packet. The P3-05 crosswalk now maps every F01–F19 injection to a named
  deterministic test and required state assertion; F18 is reserved for the
  P3-06 fresh-clone run. P3-04 candidate counts: DB 162/162, Phase-3 gate 254/254,
  concurrency 18/18, invariants 7/7 (512 fixed-seed runs), chain 10/10, E2E
  1/1, fault 186/186, adversarial 212/212, Forge 10/10. P3-06 independent
  review and clean-room evidence remain before Phase-3 readiness.

### Phase 3 planning

- P3-01 implementation was integrated at `91f649b`: migration 0026,
  fence-first atomic signing/evidence persistence, current DB binding/fixture
  revalidation, and uniqueness backstops. Later revalidation found R-033; this
  historical implementation record is not a claim that P3-01 now passes its
  complete chain-freshness acceptance.

- Accepted ADR-0018 on 2026-09-17 by product owner. Its fence-first signing,
  send-commit, signed-unbroadcast quarantine, and immutable-attempt recovery
  decisions now govern P3-01 through P3-06; P3-01 revalidation is blocked by
  R-033 and the remaining packets are gated.

- Formally opened Phase 3 / WS-005 on `phase-3/ws-005-integrated-controls`,
  then began implementation on canonical `phase-3/ws-005-implementation`.
- Added the implementation-ready P3-00 race model and P3-01–P3-06 execution
  plan, concise orchestrator handoff, and ADR-0018 for atomic
  fence-first signing, signed-unbroadcast quarantine, the `STARTED` send-commit
  boundary, and immutable-attempt recovery.
- Added planned risks/tests for the signed-to-send control race, post-send
  recovery after fence changes, canonical lock ordering, DB-time stale-worker
  fencing, and exact-once retry/takeover.
- No full Phase-3 acceptance, public-network, real-fund, production-custody, or
  S3 readiness claim is made.

### Phase 2

- Phase 2 / WS-004 merged to `main` through canonical PR #5 at `2c7e50f6aee6887ddd4af74c7bc33639707451b4` after final main-merge review `5126534096`. Post-merge `main` CI `34058182763` and Secret Scan `34058183008` pass the complete Phase-2 protected gate. S2 remains ACCEPTED only for the governing local Anvil `eip155:31337` / fake-ERC20 / disposable-identity boundary; Phase 3 remains NOT OPENED.

- Final Phase-2 closeout: external S2 acceptance review `5126373971` accepted the governing local fake-ERC20 MVP boundary; PR #17 merged at canonical SHA `34e0b53af07abff20fc36a737c17d6b0107e57bc`. Phase 2 / WS-004 is COMPLETE / ACCEPTED, the scope remains local-only, and Phase 3 is not opened.

- Reconciled final S2 evidence provenance in the docs-only P2-06D remediation: S2 requirement evidence is PASS while Gate S2 remains OPEN / NOT PASSED pending external acceptance; corrected final P2-05D/P2-06A accepted heads and recorded the protected P2-06D implementation/evidence head `6efdfd7c91b437da94b8b0e84e929f01b7aa4f46`. Fresh checks for the new docs-only head are recorded in PR #17.

- Completed P2-06D / evidence package ready from canonical SHA `7f3be19b75b798739e002ff15ece9250cfecd04b`: added explicit protected CI steps for `npm run test:fault` and `npm run test:adversarial`, fixed an expected-rejection timing race in the real-store expiry test, and recorded fresh local evidence of check `21 + 344`, Forge `10/10`, chain `10/10`, E2E `1/1`, DB `126/126`, concurrency `18/18`, invariants `7/7`, fault `133/133`, adversarial `169/169`, and audit `0`. Phase 2 implementation is complete pending external S2 review; S2 remains OPEN / NOT PASSED / READY FOR EXTERNAL REVIEW.

- Integrated externally accepted P2-06B and P2-06C on `integration/p2-06bc` from canonical base `b27202edac48cd183ec1bac8856b905447d91f49`; preserved the complete P2-06B remediation range, added the substitution/reconciliation matrix, and kept P2-06D pending. Combined local evidence is fault 133/133, adversarial 169/169, DB 126/126, concurrency 18/18, invariants 7/7, chain 10/10, E2E 1/1, Forge 10/10, check 21 repository + 344 Vitest, and audit 0 high vulnerabilities. S2 remains OPEN / NOT PASSED.

- Integrated P2-06A on canonical Phase-2 branch `phase-2/ws-004-local-erc20` (PR #5; P2-05 ACCEPTED; PRs #8 and #12 merged/closed): deterministic loopback Anvil fault proxy, method-aware fault modes, request/forward barriers, exact counters, receipt release, runtime validation and raw-transaction redaction. P2-06B/C/D remain pending; S2 remains OPEN / NOT PASSED.

- Completed P2-05D remediation on `integration/p2-05d` code SHA `a45c32d46330230614c8a72b44c0941dd0cf1850`: integrated PRE-A canonical autonomous authorization with PRE-B signer-local execution, preserved owner-approval fence snapshots, bound preparation ID collisions, ordered final policy evaluation after exact executable verification, and added an explicit protected E2E step. Local evidence is 1/1 E2E, 122/122 DB, 18/18 concurrency, 7/7 invariants, 10/10 chain, 10/10 Forge, 21 repository + 314 Vitest, and 0 high audit vulnerabilities. Protected CI `33441013501` and Secret Scan `33441013543` pass on that exact code SHA; S2 remains OPEN / NOT PASSED pending external acceptance review.
- Corrected the ERC-20 Transfer event topic for new P2-05 evidence in forward migration 0024 without editing migrations 0001–0023; existing rows with the legacy incorrect topic remain unverifiable and fail closed.

- Opened Phase 2 / WS-004 from current `main` for the local fake-ERC-20 vertical slice: construct, independently verify, simulate, authorize, locally sign, broadcast, confirm and reconcile.
- Added `docs/plans/PHASE-2.md` and `docs/workstreams/WS-004-transaction-pipeline.md` with explicit local-only boundaries, packet order, S2 evidence requirements and chain-level ambiguity/fault coverage.
- Preserved the prohibition on public RPC, testnet/mainnet, real funds, production custody and production identity.
