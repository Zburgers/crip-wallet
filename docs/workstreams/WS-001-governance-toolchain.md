# WS-001 — Governance and Toolchain

## Objective and status

Establish a reproducible, auditable, local-only repository foundation.

**Status: COMPLETE. Gate S0 PASS against the governing Product Spec.**

The repository is sole-maintainer. The active main ruleset therefore does not claim a separate-account approval; that is tracked as merge-governance risk R-019 rather than being misrepresented as an independent human review.

## Governing sources

Product Spec sections 1, 8, 13, 28, 31-36 and 40-43; ADR-0001, ADR-0007 and ADR-0013; `docs/plans/PHASE-0.md`.

## Security invariants

- local Anvil 31337 and fake state only;
- generated credentials/state ignored and never printed;
- loopback-only published services;
- dependency lockfile and audit checks;
- pinned GitHub Actions inputs;
- CODEOWNERS and vulnerability-reporting guidance;
- active branch protection;
- no real-wallet material.

## Evidence

- canonical governing paths and accepted security/governance ADRs;
- strict npm/TypeScript/repository/doc checks;
- digest-pinned PostgreSQL and deterministic Anvil local services;
- checkout-bound `.local/runtime.env` with Docker-assigned loopback ports and project-scoped cleanup;
- CI + Gitleaks, Dependabot, CODEOWNERS and contribution/security templates;
- MIT licensing via ADR-0013;
- active ruleset `20791659` requiring `validate` with deletion and non-fast-forward protections.

Later phases may strengthen merge governance, but no Phase-0 safety requirement is being treated as satisfied by a nonexistent second maintainer.
