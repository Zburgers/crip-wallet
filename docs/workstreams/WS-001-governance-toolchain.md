# WS-001 — Governance and Toolchain

## Objective and status

Establish a reproducible, auditable, local-only repository foundation. Status:
LOCAL COMPLETE / REMOTE CONTROLS VERIFIED on `phase-0/governance-foundation` from
baseline `3a044ee`; license and required review remain open.

## Governing sections

Product spec 1, 8, 13, 28, 31–36, 40–43; ADRs 0001, 0007, and 0013;
`docs/plans/PHASE-0.md`.

## Scope and ownership

Own root developer/quality configuration, `scripts/`, `tooling/`, `.github/`,
governance docs, decisions, Phase-0 plan, and repository policy tests.

Out of scope: product domain implementation, signing, wallet/RPC application
code, public interfaces, production deployment, testnet/mainnet, and license
selection without owner approval.

## Dependencies and shared contracts

Depends only on verified repository/GitHub evidence and governing documents.
May define local environment identifiers and repository conventions; must not
define product schemas owned by WS-002.

## Security invariants

- Local Anvil 31337 and fake state only.
- Generated credentials/state ignored and never printed by status commands.
- Loopback-only published services.
- CI/actions and container inputs pinned; dependencies locked and audited.
- Governance status never overclaims unimplemented behavior.

## Acceptance and tests

- P0-001 through P0-006 evidence is reproducible.
- `npm ci`, static checks, repository policy tests, and docs checks pass.
- Clean Compose startup reports PostgreSQL healthy and chain ID `0x7a69`.
- Secret/dependency scans contain no critical/high unresolved result.
- Required docs have owners/update rules and no duplicate authority.

## Deliverables, integration, and commits

Deliver root docs/config, local services, CI/security controls, and living evidence.
Integrate before WS-002. Separate commits: path normalization; spec/ADRs/governance;
tooling/local environment; CI/security controls; verification/state.

## Evidence

- Baseline and GitHub settings audit recorded 2026-08-10.
- Canonical rename commit `5a9d80c`.
- Governance/plan scaffold commit `f86fa64`.
- 2026-08-10 working tree: `npm ci` installed 131 packages and audited 132 with
  zero vulnerabilities; `npm run check` passed formatting, lint, strict types,
  14/14 Node repository tests, empty-bootstrap Vitest, 15 docs, and repo checks.
- Compose validation, Bash syntax, `npm audit --audit-level=high`, stop/start,
  PostgreSQL 17.10 readiness, deterministic quiet Anvil chain `0x7a69`, zero
  Anvil log lines, per-checkout Compose isolation, and race-safe mode `0600`
  ignored generated state passed.
- Least-privilege CI and full-history Gitleaks workflows use current exact action
  SHAs; 14/14 repository tests enforce the controls. Gitleaks 8.30.1 scanned all
  five committed revisions at `da1451c` and the exported staged candidate with
  no leaks; `docs/PROJECT_STATE.md` records the exact digest and commands.
- 2026-08-14 remote evidence: PR #1 head `081fe78` passed CI `validate` run
  `31812303081` and Gitleaks run `31812303011`. Ruleset `20791659` is active on
  `main`, requiring one approval and the registered `validate` check; Dependabot
  security fixes are enabled. The only Phase-0 closeout items still external
  are the ADR-0013 license decision and required independent review/acceptance.
