# Changelog

Owner: lead orchestrator. Update rule: record user/operator-visible, schema,
security, policy, compatibility, dependency, or governance-authority changes in
the same integration change.

## Unreleased

### Changed

- Normalized governing document paths to `docs/PRODUCT_SPEC.md` and
  `docs/LEAD_ORCHESTRATOR_PROMPT.md` without duplicate authorities.
- Clarified the budget invariant, envelope finalization order, enforcement-grade
  enum, revocation lifecycle, forward-only migration recovery, and separate
  native network-fee ceiling.

### Added

- Phase-0 ADRs, architecture, threat/security/testing guidance, roadmap, project
  state, risk register, test matrix, master/phase plans, and workstreams.
- Repository contribution and vulnerability-reporting guidance.
- Locked npm workspace tooling for formatting, linting, strict type checking,
  unit/repository tests, documentation checks, and repository policy checks.
- Digest-pinned loopback PostgreSQL and deterministic quiet Anvil services with
  generated ignored credentials, fail-closed local configuration validation,
  stable public-account verification, per-checkout Compose isolation, and
  defensive lifecycle commands.
- Least-privilege CI and full-history Gitleaks workflows with commit-pinned
  actions, CODEOWNERS, Dependabot configuration, and contribution templates.
- Canonical Zod enforcement-grade contract with the single uppercase enum and
  exhaustive strongest-to-weakest minimum-grade comparison tests.
- Strict version-1 MVP intent union and canonical uint256 atomic-unit contract;
  unknown fields, generic calls, floating values, malformed identifiers,
  noncanonical addresses, and invalid time ordering are rejected.
- Configured maximum intent-lifetime validation and versioned canonical
  idempotency payload hashing for the strict Phase-1 schema contract. The hash
  is local/provider-neutral identity metadata and is not a signing primitive.

### Security

- Recorded the real-funds prohibition and fail-closed local-chain boundary as
  release blockers.
- Recorded missing branch protection as an open S0 external-setting gap.
- Refuse non-local environment, public chain, non-loopback RPC/database hosts,
  and invalid port configuration before local services start; generated
  sensitive files are created at mode `0600` and Anvil key logs are suppressed.
