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
- Last integrated implementation: Phase-1 local proof, Anvil CI startup
  hardening, and MIT license closeout at `cd88c1a`; remote CI and the active
  main ruleset are verified, while required human review remains open.

## Current phase and status

- Phase: 1 — canonical core and local ledger (WS-002/WS-003 locally frozen)
- Status: LOCAL IMPLEMENTATION COMPLETE; S0 is ready for final external closeout and Gate S1 remains open
- Gate S0: OPEN pending required review/acceptance of PR #1. GitHub ruleset
  `20791659` (`S0 main protection`) is
  active, requires one approval and `validate`, and the remote CI/security
  checks for PR #1 are green. Secret scanning, push protection, and Dependabot
  security fixes are enabled.
- Gate S1: BLOCKED pending approval replay, revocation/pause fencing, integrated
  authorization proof, authenticated adapter/chain reconciliation, integrated
  execution recovery, independent security review, and required human
  acceptance. The WS-003 budget-ledger slice is now locally evidenced.
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
  implemented locally. Earlier PR #1 head `081fe78` passed `validate` run
  `31812303081` and Gitleaks run `31812303011`; the active main ruleset is
  verified remotely.
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

## Active blockers and risks

- External: obtain the required independent approval for PR #1 and merge only
  after human review confirms the local-only boundary and Phase-1 evidence.
- Security: local implementation proof gates are green, but external security
  acceptance and execution-boundary gates remain open; no autonomous execution
  or signing surface may be exposed.

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
  remains blocked on approval/revocation/pause fencing, authenticated
  reconciliation, integrated execution recovery, independent security review,
  and external acceptance of the review.

## Latest test results

- `npm ci`: 133 packages installed; 135 audited; 0 vulnerabilities (2026-08-10).
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
- The full unit/repository suite passed 118 Vitest tests across 8 files plus 16
  Node tests. `npm audit --audit-level=high` reported 0 vulnerabilities on the
  current lockfile.
- `npm run dev:up` and `npm run dev:status`: PostgreSQL 17.10 ready on loopback
  `127.0.0.1:32777`; deterministic quiet Anvil ready on loopback
  `127.0.0.1:32776`, chain `0x7a69`; effective values are persisted in
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
- 2026-08-14 remote PR verification: CI `validate` run `31812303081` and
  Gitleaks run `31812303011` passed at head `081fe78`. The isolated fake-money
  service step now succeeds on the GitHub Linux runner after Anvil moved its
  transient config write into container `/tmp`; the host copy is restored to
  mode `0600` and Anvil remains chain `0x7a69`.
- PR #1 remediation work starts from current head `a200e84`; no post-remediation
  merge or S0/S1 acceptance is claimed here.
- 2026-08-15 WP-02 focused verification: 20 Node repository tests and 118
  package tests passed; DB 36/36 and concurrency 1/1 across 32 rounds passed
  against the persisted 32777 runtime; invariants passed 7/7; a wrong-port
  override failed closed; the two-checkout Docker proof used distinct projects
  and effective ports; failed startup removed only the second checkout's
  project resources while preserving its volume.

## Next integration step

Keep shared WS-002 contracts frozen and withhold Phase-2 transaction,
authorization, signing, and provider consumers until Gate S1's approval,
revocation/pause, authenticated reconciliation, integrated recovery, and
independent-review evidence is accepted.

Last updated: 2026-08-15; verified WP-02 local isolation, Phase-1 ledger review,
CI, S0 ruleset, and MIT license state. S0/S1 are not marked passed.
