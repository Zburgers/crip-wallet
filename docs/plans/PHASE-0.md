# Phase 0 Foundation Plan

**Goal:** establish a reproducible local-only repository foundation and evidence-backed governance baseline.

## Governing S0 definition

Per `docs/PRODUCT_SPEC.md`, Gate S0 requires:
- secret scanning;
- dependency lockfile;
- CODEOWNERS for security-critical modules;
- branch protections;
- vulnerability-reporting instructions;
- no real-wallet material.

## Completed implementation

Phase 0 established:
- canonical governing document paths and accepted architecture/security ADRs;
- living architecture, threat, testing, roadmap, state, risk and matrix documents;
- strict npm/TypeScript/repository checks;
- digest-pinned loopback PostgreSQL and deterministic local Anvil;
- checkout-bound generated runtime state and fail-closed local configuration;
- GitHub Actions CI and Gitleaks, CODEOWNERS, Dependabot and contribution/security guidance;
- MIT licensing via ADR-0013.

WP-02 later strengthened local isolation by making `.local/runtime.env` the checkout-bound runtime authority and Docker-assigned loopback ports the effective test endpoints.

## S0 status

**PASS against the governing Product Spec.**

The live `S0 main protection` ruleset provides pull-request, required `validate`, deletion and non-fast-forward protections. The repository is sole-maintainer and therefore intentionally does not claim a separate GitHub-account approval. That limitation remains recorded as merge-governance risk R-019; it is not a Product Spec S0 requirement and must not be represented as an independent human approval.

This S0 pass does not authorize real funds, public RPC, testnet/mainnet or provider custody.
