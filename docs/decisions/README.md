# Architecture Decision Records

ADRs capture security, trust-boundary, public-contract, persistence, and tooling
decisions that future work must not silently redefine.

## Process

1. Copy `TEMPLATE.md` to the next `ADR-NNNN-short-title.md` number.
2. Set status to `Proposed`; identify affected workstreams and security impact.
3. Accept only after governing-source and test-impact review.
4. Never edit an accepted decision to change its meaning. Add a new ADR that
   supersedes it.
5. Update this index and related plans in the same change.

Owner: lead orchestrator. Update rule: whenever an ADR is proposed, accepted,
rejected, deprecated, or superseded.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](ADR-0001-provider-neutral-local-control-plane.md) | Provider-neutral local control plane | Accepted |
| [0002](ADR-0002-atomic-budget-and-reservations.md) | Atomic budget accounting and reservations | Accepted |
| [0003](ADR-0003-envelope-lifecycle-and-hashing.md) | Envelope lifecycle and hashing | Accepted |
| [0004](ADR-0004-enforcement-grade-enum.md) | Canonical enforcement-grade enum | Accepted |
| [0005](ADR-0005-revocation-and-pause.md) | Revocation and pause semantics | Accepted |
| [0006](ADR-0006-migrations-and-network-fees.md) | Forward migrations and separate network fees | Accepted |
| [0007](ADR-0007-typescript-postgres-workspace.md) | TypeScript, PostgreSQL, and workspace tooling | Accepted |
| [0008](ADR-0008-local-owner-approval.md) | Local owner approval | Accepted |
| [0009](ADR-0009-adapter-and-local-signer.md) | Adapter contract and local signer boundary | Accepted |
| [0010](ADR-0010-audit-and-telemetry.md) | Audit and lifecycle telemetry | Accepted |
| [0011](ADR-0011-worker-recovery.md) | Database-backed worker recovery | Accepted |
| [0012](ADR-0012-minimal-shared-interface.md) | Minimal interfaces over one authorization core | Accepted |
| [0013](ADR-0013-license-selection.md) | Open-source license selection | Proposed |
