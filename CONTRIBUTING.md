# Contributing to Crip Wallet

Crip is security-sensitive financial authorization software. Contributions must
preserve the authority hierarchy and real-funds prohibition in
`docs/PRODUCT_SPEC.md`.

## Before work

1. Fetch and record the intended baseline SHA.
2. Confirm a clean status and use a focused branch or isolated worktree.
3. Read the governing sections, accepted ADRs, current phase plan, workstream,
   risk register, and test matrix rows for the change.
4. Declare owned files and do not overlap another active workstream.
5. Add dependencies only with rationale, maintenance/security/license review,
   an updated lockfile, and an ADR when security-relevant.

## Development rules

- Use integer atomic units for money; floating point is prohibited.
- Authorization is deterministic and deny-by-default.
- Interfaces must not duplicate or bypass the core authorization service.
- Migrations are forward-only; recovery is forward correction or backup/restore.
- Tests come before security-critical implementation and cover negative, retry,
  concurrency, and lifecycle behavior.
- Never commit `.env`, `.local/`, keys, mnemonics, databases, traces, logs,
  receipts containing secrets, or generated build output.
- Never configure public-chain RPCs or raw signing in MVP code or examples.

## Validation

Run the smallest relevant test during development and this full local gate before
requesting review:

```bash
npm ci
npm run check
npm audit --audit-level=high
```

Database and chain work must also run the corresponding integration suite on a
fresh `npm run dev:up` environment. Record exact commands and results in the
workstream and `docs/TEST_MATRIX.md`.

## Commits and review

Use atomic imperative commits. Do not combine security behavior with unrelated
formatting or cleanup. Pull requests must state scope, security implications,
tests, migrations/recovery, known limits, documentation, and exact evidence.

Accepted ADRs are immutable; supersede them. Update `docs/PROJECT_STATE.md`, the
current phase plan, workstream, risk register, test matrix, and changelog at each
meaningful integration point.

## Licensing

This repository is licensed under the MIT License. See `LICENSE` and
`docs/decisions/ADR-0013-license-selection.md`; contributions remain subject
to the repository's local-only/fake-money boundary and required review gates.
