# ADR-0006: Forward migrations and separate network fees

## Status

Accepted — 2026-08-10

## Context

Destructive down migrations are unsafe for financial state. Native gas fees are
not ERC-20 delegated spend and must not corrupt token allocations.

## Decision

Database migrations are ordered, deterministic, and forward-only. Recovery uses
application rollback when schema-compatible, verified backup/restore, or a new
forward corrective migration. Data-loss operations require a separate reviewed
runbook and owner approval.

The MVP enforces the lower of intent and policy native network-fee ceilings. For
legacy transactions use `gasLimit * gasPrice`; for EIP-1559 use
`gasLimit * maxFeePerGas`. All operands are atomic integers. Native fee actuals
never reduce an ERC-20 allocation. Any future native rolling budget uses a
separate asset account and reservation ledger.

## Alternatives considered

- Generated destructive down migrations: rejected for financial state.
- Subtract gas from token budget: rejected because assets and units differ.
- Omit fee enforcement in MVP: rejected by the governing specification.

## Consequences

- Migration tests prove clean upgrade plus documented recovery, not automated
  destructive downgrade.
- Unsupported fee dimensions fail closed.

## Verification

- Migration checksum, upgrade, backup/restore, and forward-correction tests.
- Boundary/overflow fee arithmetic and pre-sign fee-spike tests.

## Related

- Product spec sections 18.7, 26.2, 31.1, and 34.2.
- Risks R-009 and R-010; workstreams WS-003 and WS-004.
