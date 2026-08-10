# Crip Wallet

Crip Wallet is a provider-neutral authorization and observability control plane
for AI-operated wallets. The current target is a security-bounded, fake-money
MVP running only on local Anvil chain `31337` with a mock ERC-20.

> **LOCAL TEST ONLY.** Do not use real funds, a production wallet, a seed phrase,
> mainnet, testnet, or production RPC credentials. The local signer design is not
> production custody.

## Current status

The repository is in Phase 0/early Phase 1. Governance and architecture are the
source of truth; a working wallet flow is not yet claimed. See
[`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) for verified status and gaps.

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
```

`dev:up` creates ignored local credentials and state under `.local/`, starts a
loopback-only PostgreSQL container and a deterministic disposable Anvil chain,
and never asks for wallet material. Stop it with `npm run dev:down`.

## Repository map

- `apps/`: future API, MCP, CLI, and dashboard entry points
- `packages/`: provider-neutral contracts and authorization core
- `adapters/local-anvil/`: only MVP wallet adapter
- `contracts/`: mock assets and local contracts
- `docs/`: governing, architecture, security, plans, evidence, and state
- `tests/`: integration, concurrency, invariant, adversarial, and E2E suites

## Contributing and security

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md) before
changes. Never report a suspected vulnerability in a public issue.

## License

No license has been selected. See
[`ADR-0013`](docs/decisions/ADR-0013-license-selection.md); absence of a license
means no permission is granted beyond applicable law until the owner decides.
