# Phase 0 Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use shipyard:shipyard-executing-plans to implement this plan task-by-task.

**Goal:** Establish a reproducible, local-only repository foundation and evidence-backed governance baseline.

**Architecture:** Root npm workspaces and pinned Compose services provide one
developer entry point. Governance/ADRs control later modules; no wallet execution
or autonomous surface is implemented in this phase.

**Tech Stack:** Markdown ADRs, npm, TypeScript/ESLint/Prettier/Vitest, Docker
Compose, PostgreSQL 17, Foundry/Anvil, GitHub Actions and Gitleaks.

---

### Task 1: Normalize governing paths

<task id="P0-1" name="Normalize governing paths">
  <description>Move historical onboarding names to the canonical single authorities without content changes.</description>
  <files><modify>docs/PRODUCT_SPEC.md</modify><modify>docs/LEAD_ORCHESTRATOR_PROMPT.md</modify></files>
  <steps><step>Verify old and new blob hashes match.</step><step>Run git diff --check.</step><step>Commit rename only.</step></steps>
  <verification><command>git show --summary --find-renames=100% 5a9d80c</command><expected>Two 100 percent renames and no content changes.</expected></verification>
</task>

Status: COMPLETE at commit `5a9d80c`.

### Task 2: Clarify Phase-0 security semantics

<task id="P0-2" name="Clarify security semantics">
  <description>Update the governing spec and record accepted ADRs for all mandatory clarifications and blocking decisions.</description>
  <files><modify>docs/PRODUCT_SPEC.md</modify><create>docs/decisions/ADR-0001-*.md through ADR-0013-*.md</create></files>
  <steps><step>Write decisions and consequences.</step><step>Cross-check every clarification against the governing request.</step><step>Scan for conflicting grade/equation/lifecycle text.</step><step>Commit governing clarification separately.</step></steps>
  <verification><command>npm run docs:check</command><expected>All canonical references and ADR index checks pass.</expected></verification>
</task>

### Task 3: Establish living governance

<task id="P0-3" name="Establish living governance">
  <description>Create architecture, threat, security, testing, roadmap, state, changelog, risk, matrix, plans and bounded workstreams with owners and update rules.</description>
  <files><create>docs/ARCHITECTURE.md</create><create>docs/THREAT_MODEL.md</create><create>docs/SECURITY.md</create><create>docs/TESTING.md</create><create>docs/ROADMAP.md</create><create>docs/PROJECT_STATE.md</create><create>docs/CHANGELOG.md</create><create>docs/RISK_REGISTER.md</create><create>docs/TEST_MATRIX.md</create><create>docs/workstreams/*.md</create></files>
  <steps><step>Record verified baseline and external GitHub gaps.</step><step>Map every required threat to a planned test.</step><step>Review documents for false implementation claims.</step><step>Commit with the clarification ADRs.</step></steps>
  <verification><command>npm run docs:check</command><expected>Required documents, owners, update rules, and matrix identifiers exist.</expected></verification>
</task>

### Task 4: Add repository and local tooling

<task id="P0-4" name="Add repository and local tooling">
  <description>Add strict npm tooling, ignored local state, digest-pinned local services, and safe lifecycle scripts.</description>
  <files><create>package.json</create><create>package-lock.json</create><create>tsconfig.json</create><create>eslint.config.mjs</create><create>compose.yaml</create><create>scripts/dev-*.sh</create><create>tooling/*.mjs</create><test>tests/repository/*.test.mjs</test></files>
  <steps><step>Write failing repository-policy tests.</step><step>Run them and record expected failure.</step><step>Add configs and scripts.</step><step>Run static and policy tests.</step><step>Start clean services and inspect health/config.</step><step>Commit tooling separately.</step></steps>
  <verification><command>npm ci &amp;&amp; npm run check &amp;&amp; npm run dev:up &amp;&amp; npm run dev:status</command><expected>Exit 0; PostgreSQL healthy and Anvil reports chain 0x7a69.</expected></verification>
</task>

### Task 5: Add CI and repository controls

<task id="P0-5" name="Add CI and repository controls">
  <description>Add commit-pinned checks, secret scanning, CODEOWNERS, Dependabot config, and contribution templates.</description>
  <files><create>.github/workflows/ci.yml</create><create>.github/workflows/secret-scan.yml</create><create>.github/CODEOWNERS</create><create>.github/dependabot.yml</create><create>.github/ISSUE_TEMPLATE/*.yml</create><create>.github/pull_request_template.md</create><create>.gitleaks.toml</create></files>
  <steps><step>Pin actions to immutable commits.</step><step>Validate workflow YAML and action pins.</step><step>Run local secret scan when available.</step><step>Record external branch-setting gaps.</step><step>Commit controls separately.</step></steps>
  <verification><command>npm run repo:check</command><expected>All workflow actions are SHA-pinned and required ownership/config files exist.</expected></verification>
</task>

### Task 6: Phase-0 verification and state reconciliation

<task id="P0-6" name="Verify Phase 0">
  <description>Run clean install, full local checks, service health, security review, and final diff review; update living evidence.</description>
  <files><modify>docs/PROJECT_STATE.md</modify><modify>docs/TEST_MATRIX.md</modify><modify>docs/RISK_REGISTER.md</modify><modify>docs/CHANGELOG.md</modify><modify>docs/workstreams/WS-001-governance-toolchain.md</modify></files>
  <steps><step>Run fresh verification commands.</step><step>Inspect database and chain identity.</step><step>Run dependency and secret scans.</step><step>Review full baseline diff for authority drift.</step><step>Update exact counts and remaining external gaps.</step><step>Commit state evidence.</step></steps>
  <verification><command>git diff --check 3a044ee..HEAD &amp;&amp; npm ci &amp;&amp; npm run check</command><expected>Exit 0 with exact result recorded; no false closure of external gaps.</expected></verification>
</task>

## Exit gate

Phase 0 may hand off to Phase 1 when P0-001 through P0-006 pass locally, the
governance sources agree, and no real-funds/configuration or critical security
finding exists. The active `S0 main protection` ruleset and protected remote
CI now provide the previously missing remote evidence. License choice and
required human review remain explicit external closeout items and do not
authorize Phase 2.

## Verification status

- Tasks P0-1 through P0-5 landed in commits `5a9d80c`, `e6bda04`, `f86fa64`,
  `da1451c`, and `af932d6` with spec-first and quality/security review.
- P0-6 local handoff evidence passes at implementation commit `6aa8382`: fresh
  locked install, 15 repository tests, 41 schema tests, dependency audit, live
  PostgreSQL 17.10 and Anvil 31337 inspection, permission/log checks, baseline
  diff check, and digest-pinned Gitleaks history/candidate scans.
- 2026-08-14 remote closeout: PR #1 head `081fe78` passed CI run
  `31812303081` and Gitleaks run `31812303011`; ruleset `20791659` is active
  on `main` with one required approval and the registered `validate` check;
  Dependabot security fixes are enabled. The remaining S0 closeout items are
  the ADR-0013 license decision and required independent human review/
  acceptance of PR #1. Phase 2 remains intentionally unopened.
