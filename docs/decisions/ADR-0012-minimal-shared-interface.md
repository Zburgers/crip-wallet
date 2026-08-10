# ADR-0012: Minimal interfaces over one authorization core

## Status

Accepted — 2026-08-10

## Context

MCP, CLI, dashboard, and workers can become authorization bypasses if they
duplicate rules or expose raw signing primitives.

## Decision

All interfaces call one application authorization service. MVP MCP tools are
limited to state, capability, prepare-transfer, execute, operation-status, and
eligible cancel operations. The CLI and dashboard consume the same typed API and
stable error model. There is no generic sign, send-raw-transaction, arbitrary
calldata, policy-expansion, or secret-export surface.

Interface authentication supplies identity context; caller-provided agent,
owner, or wallet identifiers are never trusted as identity. State-changing
requests require explicit idempotency keys and return operation IDs.

## Alternatives considered

- Implement authorization in each controller: rejected as a bypass risk.
- Broad wallet RPC proxy: rejected because it grants authority outside intents.

## Consequences

- Shared schemas and contract tests precede interface implementation.
- UX language must preserve uncertainty and enforcement-grade distinctions.

## Verification

- Cross-interface decision parity, authentication confusion, raw-method denial,
  idempotency, rate-limit, and structured-error tests.

## Related

- Product spec sections 12.1, 24, and 25.
- Risks R-016 and R-017; workstreams WS-006 and WS-007.
