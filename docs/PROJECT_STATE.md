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
- Last integrated implementation: WS-002 canonical contract slice
  (policy/decision, lifecycle, envelope serialization/hash, adapter, audit,
  telemetry, errors, and deterministic policy evaluation)

## Current phase and status

- Phase: 1 — canonical core and local ledger (WS-002 contracts started)
- Status: IN PROGRESS; Phase-0 local controls verified, external S0 remains open
- Gate S0: OPEN; GitHub secret scanning and push protection are enabled, but
  `main` has no branch protection and Dependabot security updates are disabled.
- Gate S1: BLOCKED pending approval replay, revocation/pause fencing, integrated
  authorization proof, independent security review, and protected CI. The WS-003
  budget-ledger slice is now locally evidenced.
- Gate S2: BLOCKED; no local end-to-end transaction vertical slice exists.

## Implemented and verified

- Canonical governing paths are committed with byte-identical history-preserving
  renames.
- The live baseline, remote, branch, history, file tree, and GitHub safety
  settings were inspected on 2026-08-10.
- Phase-0 tooling is implemented in the working tree: npm lock/config, static
  checks, repository policy tests, digest-pinned Compose, fail-closed local
  environment validation, deterministic Anvil fixture, per-checkout container
  and database isolation, and defensive lifecycle scripts.
- CI, secret scanning, CODEOWNERS, Dependabot, and contribution templates are
  implemented locally; protected remote execution remains unevidenced until the
  branch is pushed and reviewed.
- WS-002 has begun without any signing surface: the canonical enforcement-grade
  schema/order plus strict read/transfer intent and uint256 atomic-money leaf
  contracts are implemented and unit tested. P1-002 now also validates the
  configured lifetime ceiling and exports canonical idempotency payload hashing;
  the remaining WS-002 contract groups are strict, transition-tested, and the
  envelope hash vector is deterministic and approval-bound. Policy evaluation
  is deterministic, combination-tested, and fail-closed.
- WS-003 now has forward PostgreSQL migrations, immutable/append-only tables,
  one-client serializable transactions with bounded 40001 retry, balanced
  reservation lifecycle methods, idempotency conflict protection, and a
  transactional audit package. No signing or broadcast surface was added.

## Active blockers and risks

- External: protect `main` with required CI/review rules and enable Dependabot
  security updates after CI lands.
- Product decision: license selection (ADR-0013).
- Security: all implementation proof gates remain open; no autonomous execution
  or signing surface may be exposed.

## Open decisions

- ADR-0013 license selection requires product-owner approval.
- Non-blocking later decisions: exact Safe/testnet adapter, production owner
  identity, hosted boundary, and post-MVP formal verification.

## Active workstreams

- WS-001 governance and toolchain — local implementation verified; remote gates open.
- WS-002 canonical domain contracts — active; P1-001, P1-002, and P1-003
  accepted locally.
- WS-003 atomic ledger proof — local implementation/evidence complete; Gate S1
  remains blocked on the wider authorization proof and independent review.

## Latest test results

- `npm ci`: 133 packages installed; 135 audited; 0 vulnerabilities (2026-08-10).
- Prior `npm run check`: exit 0; format, ESLint, strict typecheck, 15/15 Node
  repository tests, 41/41 schema Vitest tests, 15 required docs, and repository
  policy checks passed. The Node suite imports `@crip/schemas` through its built
  package export rather than a source-only test path. `npm run test:unit`
  recreated the removed `packages/schemas/dist/` artifact before passing,
  proving the documented standalone command has its own build prerequisite.
- 2026-08-13 focused verification: schema build, strict typecheck, formatting,
  and the targeted contract files passed (64 WS-002 contract/hash/evaluation
  tests plus the existing schema tests). Full `npm run check`
  passed with 16 repository tests and 111 Vitest tests; documentation checks,
  repository policy checks, and `npm audit --audit-level=high` also passed with
  zero vulnerabilities.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- 2026-08-13 WS-003 verification: `npm run test:db` passed 11/11,
  `npm run test:concurrency` passed 1/1 across 32 rounds and 4 workers, and
  `npm run test:invariants` passed 6/6. Static format, lint, and strict
  typecheck passed; full unit/repository suite passed 117 Vitest + 16 Node
  tests. Final concurrency rows were allocated=100, available=10, reserved=90,
  finalized_spend=0 with three audit rows.
- `npm run dev:up` and `npm run dev:status`: PostgreSQL 17.10 ready on loopback
  `55432`; deterministic quiet Anvil ready on loopback `8545`, chain `0x7a69`.
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

## Next integration step

Withhold transaction/authorization consumers until WS-002 review completes and
Gate S1's approval, revocation/pause, integrated, and independent-review
evidence exists.

Last updated: 2026-08-13; verified working tree for the WS-002 contract slice.
