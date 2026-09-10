# Crip Wallet

**The open-source control plane for AI-operated wallets.**

Crip sits between an AI agent's financial intent and the wallet that can execute it. It gives the owner a deterministic place to define **what the agent may do, how much it may spend, when human approval is required, and what actually happened after execution**.

Instead of giving an agent unrestricted signing authority, Crip turns wallet access into bounded, observable financial authority.

> [!WARNING]
> **Pre-release / local test environment only.** Crip currently runs against local Anvil chain `31337` with disposable keys and a mock ERC-20. Do **not** use it with real funds, production wallets, seed phrases, public RPC endpoints, testnet/mainnet assets, or production credentials.

## Why Crip exists

AI agents increasingly need to pay for services, interact with protocols, manage operational budgets, and execute financial workflows.

The obvious approaches both have bad failure modes:

- give the agent a raw private key and it has too much authority;
- require a human signature for every action and useful autonomy disappears.

Crip is the layer between those extremes.

The core question is not simply **"can the agent sign?"** It is:

> **What exact financial authority has the owner delegated, does this action fit inside it, and can we prove the executed transaction matched what was authorized?**

## What Crip is

Crip is a **provider-neutral authorization and observability runtime** for wallets operated by agents and automated systems.

It separates concerns that are often bundled together in agent-wallet products:

1. **Agent intent** — what the agent says it wants to do.
2. **Policy authorization** — what the owner has actually permitted.
3. **Transaction construction and verification** — what will execute on-chain.
4. **Wallet custody and signing** — where keys live and how signatures are produced.
5. **Execution evidence** — what was proposed, authorized, signed, broadcast, confirmed, and reconciled.

The long-term goal is not to become one more proprietary wallet backend. Crip is designed so the same authorization model can govern different wallet and signer providers through adapters.

## The control path

```text
untrusted AI agent
        |
        v
     intent
        |
        v
 deterministic policy
        |
        +---- DENY --------------------------+
        |                                    |
        v                                    |
 atomic budget reservation                   |
        |                                    |
        v                                    |
construct -> verify -> simulate              |
        |                                    |
        v                                    |
approval / autonomous authorization          |
        |                                    |
        v                                    |
 immutable execution envelope                |
        |                                    |
        v                                    |
 wallet / signer adapter                     |
        |                                    |
        v                                    |
      chain                                  |
        |                                    |
        v                                    |
confirm -> reconcile -> audit <--------------+
```

The API, CLI, MCP, or browser layer may authenticate and validate requests, but it does **not** become the final authorization boundary. Authorization is deterministic software backed by persisted policy, budget, approval, control-fence, and execution state.

## What Crip is trying to guarantee

The governing MVP invariant is:

> For every possible sequence of agent requests, retries, concurrent submissions, policy changes, and execution failures, an agent must never be able to authorize more value or broader authority than the active user policy permits.

That leads to several design rules:

- **No LLM decides financial authorization.** Models may explain or propose; deterministic software decides.
- **Budgets are accounting state, not prompt instructions.** Reservations are atomic and concurrency-safe.
- **Approval is bound to execution.** Human approval must correspond to the exact immutable execution envelope being authorized.
- **Retries cannot create new authority.** Idempotency and stale-worker fencing are part of the security model.
- **Unknown state fails closed.** Ambiguous execution outcomes remain protected until authoritative reconciliation.
- **Revocation and pause invalidate stale authority.** Resuming does not silently resurrect old approvals.
- **Enforcement strength is explicit.** Crip distinguishes `ONCHAIN`, `SIGNER`, `CONTROL_PLANE`, `ADVISORY`, and `UNSUPPORTED` guarantees instead of presenting them as equivalent.
- **Every financial action is traceable.** Intent, policy, approval, execution, confirmation, and reconciliation are correlated in durable evidence.

## Current status

Crip is being built in public as a security-bounded local implementation before any production-wallet integration is allowed.

### Completed

- **Phase 0 / S0 — PASS**: repository governance, reproducible local environment, secret scanning, dependency controls, and repository safety.
- **Phase 1 / S1 — PASS / ACCEPTED**: canonical contracts, PostgreSQL atomic budget ledger, idempotency, approval replay protection, pause/revocation fencing, authenticated local control evidence, and deterministic concurrency/property proofs.
- **Phase 2 / S2 — COMPLETE / ACCEPTED**: local fake-ERC-20 execution vertical slice:

```text
construct -> independently verify -> simulate -> authorize
          -> locally sign -> broadcast -> confirm -> reconcile
```

Phase 2 has been externally reviewed and merged to `main`. The complete accepted boundary remains **local Anvil + fake money only**.

### Not shipped yet

- integrated Phase-3 approval/revocation/pause/recovery behavior across the complete execution boundary;
- public MCP, CLI, dashboard, and Agent Skill interfaces;
- production-grade Safe, MetaMask, Turnkey, or other wallet-provider adapters;
- testnet/mainnet operation;
- production custody or real-funds support.

See [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the exact current gate state.

## Run the local environment

### Prerequisites

- Docker Engine or Docker Desktop with Compose
- Node.js `>=24 <27`
- npm `>=11 <12`

Install and validate the repository:

```bash
npm ci
npm run check
```

Start the isolated local PostgreSQL + Anvil environment:

```bash
npm run dev:up
npm run dev:status
```

Run the core Phase-1 safety gates:

```bash
npm run test:db
npm run test:concurrency
npm run test:invariants
```

Run the Phase-2 chain path and adversarial/fault evidence:

```bash
npm run test:chain
npm run test:fault
npm run test:adversarial
npm run test:e2e
```

Shut the environment down:

```bash
npm run dev:down
```

`dev:up` creates ignored disposable local state under `.local/`, starts loopback-only services, and never asks for production wallet material.

## What to look at first

If you are evaluating the architecture rather than only running the tests:

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — governing product and security requirements.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — component boundaries and trusted data flow.
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — attacker model and security assumptions.
- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — current accepted implementation state.
- [`docs/TEST_MATRIX.md`](docs/TEST_MATRIX.md) — reproducible gate and review evidence.
- [`docs/decisions/`](docs/decisions/) — architecture decision records.

## Provider-neutral by design

Crip's intended architecture is:

```text
                         +-- Safe
                         +-- MetaMask Agent Wallet
AI agent -> Crip --------+-- Turnkey / signer infrastructure
                         +-- local reference adapter
                         +-- future wallet providers
```

The adapter should provide custody/signing/execution capabilities. Crip should own the normalized intent, policy, budget, approval, execution-binding, observability, and reconciliation semantics.

That separation is deliberate: switching wallet providers should not require an agent developer to reinvent the financial authorization model.

## What Crip is not

Crip is **not**:

- an unrestricted transaction-signing API for agents;
- an LLM policy engine;
- a custodial exchange wallet;
- a production-ready MetaMask replacement;
- a claim that control-plane enforcement is equivalent to signer- or on-chain enforcement;
- ready for real money today.

The project would rather expose a weaker guarantee explicitly than imply a security property the selected adapter cannot enforce.

## Roadmap

The current sequence is intentionally safety-first:

1. governance and local reproducibility — complete;
2. authorization, ledger, replay, pause/revocation, and concurrency proof — accepted;
3. local construct/verify/simulate/sign/broadcast/reconcile vertical slice — accepted;
4. integrated execution-boundary controls and recovery;
5. MCP + CLI + local dashboard + Agent Skill;
6. telemetry, adversarial hardening, and MVP review;
7. only then: explicitly approved testnet/provider adapters.

The roadmap is governed by [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md), not by this summary.

## We want adversarial feedback

Crip is early enough that architecture criticism is more useful than applause.

If you build AI agents that spend crypto, work on wallet infrastructure, smart accounts, account abstraction, x402 payments, or policy-controlled signing, we are especially interested in:

- how you currently delegate wallet authority to agents;
- where existing spend-limit or approval systems break down for you;
- which wallet/signer backend you would want a provider-neutral control layer to support first;
- attacks or failure cases the current threat model is missing.

For security vulnerabilities, follow [`SECURITY.md`](SECURITY.md) rather than opening a public issue.

## Repository map

```text
apps/                 future public API / MCP / CLI / dashboard surfaces
packages/             provider-neutral schemas, policy, ledger, and transaction core
adapters/local-anvil/  disposable local reference execution adapter
contracts/             mock local assets/contracts
docs/                  product authority, architecture, security, ADRs, plans, evidence
tests/                 integration, DB, concurrency, invariant, fault, adversarial, E2E
tooling/               reproducible test and evidence gates
```

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md) before making changes.

Crip's financial/security invariants are treated as governing constraints. Changes that alter trust boundaries, policy semantics, signing authority, or execution guarantees require corresponding tests and architecture documentation rather than implementation-only patches.

## License

MIT. See [`LICENSE`](LICENSE) and [`ADR-0013`](docs/decisions/ADR-0013-license-selection.md).
