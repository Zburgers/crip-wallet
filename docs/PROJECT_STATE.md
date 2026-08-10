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
- Last integrated commit: `f86fa64` (Phase-0 governance scaffold)

## Current phase and status

- Phase: 0 — governance and repository foundation
- Status: IN PROGRESS
- Gate S0: OPEN; GitHub secret scanning and push protection are enabled, but
  `main` has no branch protection and Dependabot security updates are disabled.
- Gates S1/S2: BLOCKED because no authorization core or local vertical slice has
  yet been proven.

## Implemented and verified

- Canonical governing paths are committed with byte-identical history-preserving
  renames.
- The live baseline, remote, branch, history, file tree, and GitHub safety
  settings were inspected on 2026-08-10.
- Phase-0 tooling is implemented in the working tree: npm lock/config, static
  checks, repository policy tests, digest-pinned Compose, fail-closed local
  environment validation, deterministic Anvil fixture, per-checkout container
  and database isolation, and defensive lifecycle scripts.

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

- WS-001 governance and toolchain — active.
- WS-002 canonical domain contracts — queued after Phase-0 validation.
- WS-003 atomic ledger proof — blocked on WS-002 schemas and migrations.

## Latest test results

- `npm ci`: 131 packages installed; 132 audited; 0 vulnerabilities (2026-08-10).
- `npm run check`: exit 0; format, ESLint, strict typecheck, 13/13 Node repository
  tests, Vitest no-TypeScript-bootstrap suite, 15 required docs, and repository
  policy checks passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run dev:up` and `npm run dev:status`: PostgreSQL 17.10 ready on loopback
  `55432`; deterministic quiet Anvil ready on loopback `8545`, chain `0x7a69`.
- Generated runtime/Anvil configs are Git-ignored, mode `0600`; Anvil log output
  is empty. The Anvil config inode is created at `0600` before container startup.
  Compose and all Bash files validate.

## Next integration step

Commit the verified toolchain/local environment, then add and validate CI,
secret scanning, CODEOWNERS, Dependabot configuration, and GitHub templates.

Last updated: 2026-08-10; verified working tree based on `f86fa64`.
