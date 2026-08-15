# Project State

Owner: lead orchestrator. Update rule: at every meaningful integration point;
keep this as the current resume snapshot rather than an activity log.

## Baseline

- Repository: `git@github.com:Zburgers/crip-wallet.git`
- Base branch: `main`
- Verified start SHA: `3a044ee788297bf006c633ce97d61b30a6e6cf40`
- Starting contents: README plus two governing documents; no code, tests, CI,
  manifests, local databases, build output, generated junk, or secret-pattern
  findings in the current tree or two-commit history.
- Working branch: `phase-0/governance-foundation`
- Last integrated implementation: WP-05 authenticated recovery proof at
  `515e8e2`; remote CI and Secret scan are green at the current PR head, while
  repository approval controls and required human review remain open.

## Current phase and status

- Phase: 1 — canonical core and local ledger (WS-002/WS-003 locally frozen)
- Status: LOCAL IMPLEMENTATION COMPLETE; S0 remains open under the sole-maintainer
  approval limitation and Gate S1 remains blocked
- Gate S0: OPEN. GitHub ruleset `20791659` (`S0 main protection`) is active and
  enforces pull requests, `validate`, deletion protection, and non-fast-forward
  protection, but the live API reports `required_approving_review_count=0` and
  `required_review_thread_resolution=false`; PR #1 has no independent approval
  (`reviewDecision=null`). Current-head CI and Secret scan are green. Secret
  scanning, push protection, and Dependabot security updates are enabled.
- Gate S1: BLOCKED pending owner authentication, independent security review,
  required human acceptance, and integrated provider/chain reconciliation. WP-05
  now supplies local authenticated adapter/reconciler and deterministic recovery
  evidence; provider/chain reconciliation remains out of scope.
- Gate S2: BLOCKED; no local end-to-end transaction vertical slice exists.

## Implemented and verified

- Canonical governing paths are committed with byte-identical history-preserving
  renames.
- The live baseline, remote, branch, history, file tree, and GitHub safety
  settings were inspected on 2026-08-10.
- Phase-0 tooling is implemented in the working tree: npm lock/config, static
  checks, repository policy tests, digest-pinned Compose, fail-closed local
  environment validation, deterministic Anvil fixture, checkout-bound
  effective runtime state, per-checkout container/database isolation, and
  defensive lifecycle scripts with project-scoped partial-start cleanup.
- CI, secret scanning, CODEOWNERS, Dependabot, and contribution templates are
  implemented locally. Current PR #1 head `515e8e2` passed `validate` run
  `31880041818` and Secret scan/Gitleaks run `31880040380`; the live ruleset
  and repository security settings were rechecked for this review.
- WS-002 is locally frozen without any signing surface: the canonical enforcement-grade
  schema/order plus strict read/transfer intent and uint256 atomic-money leaf
  contracts are implemented and unit tested. P1-002 now also validates the
  configured lifetime ceiling and exports canonical idempotency payload hashing;
  the remaining WS-002 contract groups are strict, transition-tested, and the
  envelope hash vector is deterministic and approval-bound. Policy evaluation
  is deterministic, combination-tested, and fail-closed.
- WS-003 now has forward PostgreSQL migrations, immutable/append-only tables,
  one-client serializable transactions with bounded 40001 retry, balanced
  reservation lifecycle methods including evidence-gated authorization and
  broadcast fencing, request-bound idempotency conflict protection, typed full-
  event audit verification with a database hash guard, and local proofs for
  worker response-loss retry, real serialization retry, migration recovery,
  ambiguous-funds retention, generated event sequences, and binding guards. No
  signing or autonomous execution surface was added.
- WP-02 makes `.local/runtime.env` the single effective local runtime source.
  Docker-assigned loopback ports are persisted mode `0600`; DB and concurrency
  tests use the same loader and reject conflicting overrides or copied runtime
  state. The audit ledger derives correlation from locked database rows and
  rejects mismatches in application and PostgreSQL guards.
- WP-03 adds a focused local authorization proof in `@crip/approvals` with
  persisted approval requests, append-only decisions, exact operation/envelope
  revision/hash/policy-decision bindings, database Keccak envelope verification,
  schema validation, atomic envelope replacement invalidation/revalidation,
  expiry/rejection/revocation handling, unique authorization evidence, deferred
  operation/reservation consistency guards, and serializable one-time
  consumption. It intentionally adds no owner-key or provider signing.
- WP-04 adds the authorization safety fence required by ADR-0005: authoritative
  `control_fences` state for system/owner/agent/policy scopes; monotonic fence
  snapshots on approval, decision, and authorization evidence; shared lock
  ordering; transactional invalidation of stale pending/authorized work;
  eligible held-reservation release; and append-only control/invalidation audit
  evidence. Resume advances the system fence and never resurrects stale
  approvals. No signing or broadcast surface was added.
- WP-05 adds pre-provisioned Ed25519 component credentials, signed action
  payloads, immutable execution-evidence identity snapshots, versioned recovery
  leases, append-only recovery attempts, stale-worker fencing, conflict
  rejection, and exactly-once local finalization. AMBIGUOUS and CONFLICT remain
  DISPUTED with funds reserved. No provider, RPC, transaction signing, testnet,
  mainnet, or real-funds surface was added.

## Active blockers and risks

- External: the sole-maintainer ruleset intentionally has zero required
  approvals. Obtain independent review capacity and enable the required approval
  and review-thread controls before claiming S0 under the work-packet criterion.
  Merge only after human review confirms the local-only boundary and Phase-1
  evidence.
- Security: local implementation proof gates are green, but external security
  acceptance and execution-boundary gates remain open; no autonomous execution
  or signing surface may be exposed.
- Contract boundary: ADR-0008 specifies a loopback owner session and local test
  signing key, while WP-03 explicitly prohibits signing. The persisted
  approver/authorization evidence is therefore not owner authentication; that
  contradiction must be resolved before claiming the complete owner-approval
  control or Gate S1.

## Open decisions

- ADR-0013 is accepted as MIT; future licensing changes require a superseding
  ADR before dependent production scope lands.
- Non-blocking later decisions: exact Safe/testnet adapter, production owner
  identity, hosted boundary, and post-MVP formal verification.

## Active workstreams

- WS-001 governance and toolchain — local implementation, license, and remote
  CI/ruleset verification complete; required review remains open.
- WS-002 canonical domain contracts — locally frozen; P1-001, P1-002, and
  P1-003 accepted locally pending Gate S1 and required review acceptance.
- WS-003 atomic ledger proof — local implementation/evidence complete; Gate S1
  remains blocked on independent security review and external acceptance.
- WS-005 approval and controls — WP-04 control-fence and WP-05 authenticated
  recovery proofs complete locally; Gate S1 remains blocked on owner
  authentication, provider/signing boundary, chain reconciliation, independent
  security review, and acceptance.

## Latest test results

- `npm ci`: 156 packages installed; 163 audited; 0 vulnerabilities (2026-08-15).
- Prior `npm run check`: exit 0; format, ESLint, strict typecheck, 15/15 Node
  repository tests, 41/41 schema Vitest tests, 15 required docs, and repository
  policy checks passed. The Node suite imports `@crip/schemas` through its built
  package export rather than a source-only test path. `npm run test:unit`
  recreated the removed `packages/schemas/dist/` artifact before passing,
  proving the documented standalone command has its own build prerequisite.
- 2026-08-13 local Phase-1 verification: schema build, strict typecheck,
  formatting, and the focused contract files passed. `npm run test:db` passed
  25/25, including pending/verified evidence-gated broadcast/finalization, full
  row-bound audit hash verification, request-bound idempotency, worker
  response-loss replay, real serialization retry, concurrent migration runners,
  legacy-audit fail-closed recovery, DDL rollback, and budget binding. `npm run
test:concurrency` passed 1/1 across 32 rounds and 4 workers;
  `npm run test:invariants` passed 7/7 with seeds 2026081301, 2026081302, and
  2026081303 (512 generated runs). Final concurrency rows were allocated=100,
  available=10, reserved=90, finalized_spend=0 with three audit rows.
- Current WP-06 `npm run check` passed 118 Vitest tests across 8 files plus 20
  Node repository tests. `npm audit --audit-level=high` reported 0
  vulnerabilities on the current lockfile.
- Current WP-06 `npm run dev:up` and `npm run dev:status`: PostgreSQL 17.10 ready
  on loopback `127.0.0.1:32820`; deterministic quiet Anvil ready on loopback
  `127.0.0.1:32821`, chain `0x7a69`; effective values are persisted in
  `.local/runtime.env`.
- Generated runtime/Anvil configs are Git-ignored, mode `0600`; Anvil log output
  is empty. The Anvil config inode is created at `0600` before container startup.
  Compose and all Bash files validate.
- Gitleaks 8.30.1 image digest `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`
  ran `gitleaks git --config .gitleaks.toml --no-banner --redact --verbose .`
  at `6aa8382`: eight revisions, no leaks. The final index was exported with
  `git checkout-index --all --prefix=<ignored-snapshot>/` and scanned with the
  same image using `gitleaks dir`: no leaks. Ignored `.local/` runtime state was
  excluded because it contains the generated disposable database password by
  design; no scan result for that directory is claimed.
- 2026-08-15 current-head remote PR verification: CI `validate` run
  `31880041818` and Secret scan/Gitleaks run `31880040380` passed at head
  `515e8e2c6fe1547ea5d0806033e024564ddd680e`. The isolated fake-money service
  step, mode `0600`, and quiet signer-log checks passed remotely.
- 2026-08-15 WP-02 focused verification: 20 Node repository tests and 118
  package tests passed; DB 36/36 and concurrency 1/1 across 32 rounds passed
  against the persisted 32777 runtime; invariants passed 7/7; a wrong-port
  override failed closed; the two-checkout Docker proof used distinct projects
  and effective ports; failed startup removed only the second checkout's
  project resources while preserving its volume.
- 2026-08-15 WP-03 focused verification: approval DB proof passed 21/21 and
  concurrent consumption passed 1/1; the full DB gate passed 57/57, concurrency
  passed 2/2 including the 32-round reservation suite, invariants passed 7/7,
  and static/unit/repository/docs checks remained green. The local runtime was
  recreated from the current forward migration set; no Gate S1 pass is claimed.
- 2026-08-15 WP-04 focused verification: migration set is 16 forward migrations;
  `tests/concurrency/control-fence.test.ts` passed 14/14 with deterministic
  row-lock barriers; full `npm run test:db` passed 57/57 and
  `npm run test:concurrency` passed 16/16. Ledger rows preserved
  `allocated = available + reserved + finalized_spend`; no Gate S1 pass is
  claimed.
- 2026-08-15 WP-05 focused verification: migration set is 18 forward migrations;
  `tests/db/wp05-recovery.test.ts` passed 7/7 for authenticated component
  acceptance/rejection, uncertain-outcome recovery, crash/retry idempotency,
  simultaneous/stale workers, conflicting evidence, protected funds, and
  exactly-once finalization. No Gate S1 pass is claimed.
- 2026-08-15 WP-06 fresh required-command verification at current head: local
  PostgreSQL `127.0.0.1:32820` and Anvil `127.0.0.1:32821` were healthy on
  chain `0x7a69`; DB passed 64/64, concurrency passed 16/16 with workers=4,
  rounds=32 and the ready/start/release barriers, and invariants passed 7/7
  with seeds `2026081301`, `2026081302`, `2026081303` and `numRuns=512`.
  `dev:down` removed only this checkout's containers/network and preserved
  ignored state. No S0/S1 pass is claimed.

## Next integration step

Keep shared WS-002 contracts frozen and withhold Phase-2 transaction execution,
signing, and provider consumers until Gate S1's approval,
revocation/pause, independent security review, owner authentication, and
provider/chain reconciliation acceptance is complete.

Last updated: 2026-08-15; verified WP-05/WP-06 evidence, current PR-head CI and
Secret scan, live S0 ruleset/security settings, local isolation, Phase-1 ledger
review, and MIT license state. S0/S1 are not marked passed.
