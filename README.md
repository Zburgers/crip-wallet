# Crip Wallet

Crip Wallet is a provider-neutral authorization and observability control plane
for AI-operated wallets. The MVP is deliberately fake-money and local-only on
Anvil chain `31337` with a mock ERC-20.

> **LOCAL TEST ONLY.** Do not use real funds, production wallets, seed phrases,
> mainnet, testnet, or production RPC credentials. The local signer design is
> not production custody.

## Current status

Phase 0 repository/governance foundations and Gate S0 are complete. Phase 1 and
Gate S1 are accepted: the protected `validate` workflow now proves the core
budget, idempotency, authenticated approval/replay, revocation/pause and
integer-money invariants on PostgreSQL, with deterministic concurrency and
property tests on the merge path.

PR #1 is the Phase 0/1 closeout PR. After its final documentation-only closeout
head remains green and the PR is merged/closed out, Phase 2 / WS-004 is ready to
open for the local fake-ERC-20 Anvil transaction vertical slice.

See [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) for exact gate evidence and
phase ownership.

## Authority

1. Product-owner instructions
2. [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)
3. Accepted [`docs/decisions/`](docs/decisions/README.md)
4. Approved plans and workstreams
5. Tests, then implementation

## Developer bootstrap

Prerequisites: Docker Desktop or Docker Engine with Compose, Node.js 24 LTS, and
npm 11.

```bash
npm ci
npm run check
npm run dev:up
npm run dev:status
npm run test:db
npm run test:concurrency
npm run test:invariants
npm run dev:down
```

`dev:up` creates ignored local credentials and state under `.local/`, starts a
loopback-only PostgreSQL container and deterministic disposable Anvil chain, and
never asks for wallet material.

## Repository map

- `apps/`: future API, MCP, CLI, and dashboard entry points
- `packages/`: provider-neutral contracts and authorization core
- `adapters/local-anvil/`: Phase 2 local adapter target
- `contracts/`: mock assets and local contracts
- `docs/`: governing, architecture, security, plans, evidence, and state
- `tests/`: integration, concurrency, invariant, adversarial, and E2E suites

## Contributing and security

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md) before
changes. Never report a suspected vulnerability in a public issue.

## License

This project is licensed under the [MIT License](LICENSE). The decision is
recorded in [`ADR-0013`](docs/decisions/ADR-0013-license-selection.md).
