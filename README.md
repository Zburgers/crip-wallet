# Crip Wallet

Crip Wallet is a provider-neutral authorization and observability control plane
for AI-operated wallets. The MVP is deliberately fake-money and local-only on
Anvil chain `31337` with a mock ERC-20.

> **LOCAL TEST ONLY.** Do not use real funds, production wallets, seed phrases,
> mainnet, testnet, or production RPC credentials. The local signer design is
> not production custody.

## Current status

Phase 0 repository/governance foundations and the Phase 1 S1 core-invariant
implementation are present on PR #1. Phase 1 now includes the deliberately
pulled-forward local authorization/control slice needed by Gate S1: canonical
authorization evidence, authenticated local-owner approval, replay protection,
revocation/pause fencing, and hardened recovery leases. Phase 2 transaction
construction/signing/provider/chain integration remains unopened until the
Phase 1 closeout evidence is accepted.

See [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) for the current gate status
and exact evidence.

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
