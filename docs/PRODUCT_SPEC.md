# Crip Wallet — Governing Product Specification

**Document status:** Governing authority for MVP design and implementation  
**Product name:** Crip Wallet  
**Repository working name:** `crip-wallet`  
**Version:** 0.1.0  
**Baseline date:** 2026-08-06  
**Primary milestone:** Working, security-bounded local MVP  
**Audience:** Product owners, lead orchestrator, implementation agents, reviewers, security engineers, and contributors  
**Change authority:** Product owner approval is required for material scope, security-model, or trust-boundary changes

---

## 1. Document Authority

This document is the primary product and engineering authority for Crip Wallet until the MVP governance process replaces it with a newer approved version.

When implementation artifacts conflict, the following precedence applies:

1. Explicit product-owner instruction
2. This governing product specification
3. Accepted Architecture Decision Records (ADRs)
4. Approved milestone and workstream plans
5. Accepted issue or pull-request acceptance criteria
6. Existing implementation behavior
7. Agent assumptions

Existing code is not automatically correct merely because it already exists. If code conflicts with this specification, the conflict must be documented and resolved rather than silently treating the code as the source of truth.

Material changes must update, in the same pull request:

- This document or an approved successor
- The relevant ADR
- The implementation plan or workstream status
- Tests and threat-model coverage
- The changelog when user-visible or security-relevant

No implementation agent may silently weaken a MUST requirement.

---

## 2. Executive Summary

Crip Wallet is an open-source, provider-neutral authorization and observability runtime for wallets operated by AI agents and automated systems.

Crip does not exist merely to expose wallet commands through MCP. Its central purpose is to ensure that an agent can only exercise the exact financial authority delegated by a user, while remaining observable, revocable, testable, and portable across wallet providers.

Crip separates five concerns that are frequently coupled in existing agent-wallet products:

1. **Agent intent** — what the agent says it wants to do
2. **Policy authorization** — what the user has permitted
3. **Transaction construction and verification** — what will actually execute on-chain
4. **Wallet custody and signing** — where keys live and how signatures are produced
5. **Execution evidence** — what was proposed, approved, signed, broadcast, confirmed, and reconciled

The MVP will prove the core safety invariant in a fully local EVM environment with fake assets:

> For every possible sequence of agent requests, retries, concurrent submissions, policy changes, and execution failures, an agent must never be able to authorize more value or broader authority than the active user policy permits.

The MVP will not use the product owner's existing MetaMask wallet, mainnet funds, real stablecoins, or production credentials.

---

## 3. Product Thesis

AI agents will increasingly need to make payments, execute protocol interactions, manage bounded operational budgets, and coordinate with other automated systems. Giving an agent a raw private key is an unacceptable default. Requiring a human signature for every action prevents useful autonomy.

Crip occupies the layer between those extremes.

It provides:

- Human ownership and revocation
- Deterministic policies
- Hard and soft enforcement distinctions
- Atomic budget reservations
- Transaction simulation
- Calldata and signature decoding
- Human approval workflows
- Restricted signing adapters
- Provider-neutral APIs
- Complete lifecycle observability
- Adversarial and conformance testing

The intended open-source category is:

> **Agent Wallet Control Plane**

Crip is not intended to compete solely as another custodial wallet. It is intended to govern multiple wallet and signer backends through one normalized intent, policy, approval, and audit model.

---

## 4. Competitive and Standards Context

As of the baseline date, existing products validate the category:

- MetaMask Agent Wallet exposes an agent-oriented CLI, wallet modes, transaction simulation, threat scanning, asynchronous approval, machine-readable output, and policy-oriented trading modes.
- Safe provides smart-account modules and token spending allowances that can give an agent bounded authority while funds remain in a user-controlled smart account.
- Turnkey provides enclave-backed signing and signer-enforced policies for delegated agent access.
- Other wallet infrastructure providers expose programmatic wallets and various policy systems.
- WalletConnect provides broad wallet connectivity, but connectivity alone does not establish a portable agent authorization standard.
- MCP and Agent Skills provide useful agent interfaces, but neither protocol is itself the financial security boundary.

Crip will take architectural inspiration from these systems without copying proprietary implementations or creating a provider-specific clone.

### 4.1 Initial standards targets

Crip should align with, or remain compatible with, the following where useful:

- JSON-RPC 2.0
- Model Context Protocol
- Agent Skills specification
- OpenTelemetry traces, metrics, logs, and baggage
- CAIP-2 chain identifiers
- EIP-712 typed structured data
- ERC-4337 account abstraction
- ERC-7579 modular smart accounts
- ERC-7710 smart-contract delegation
- ERC-7715 advanced permissions
- EIP-1271 smart-contract signatures
- EIP-7702 delegated EOA execution, only after explicit security review
- ERC-7821 batching, only after explicit security review

Standards compatibility must not override the product’s security invariants. A standard feature that cannot be safely interpreted must be denied or escalated.

---

## 5. Vision

A developer should be able to connect an agent to Crip and state:

> “This agent may spend up to 2 test USDC in total, no more than 0.50 per transaction, only on the local test chain, only to this merchant, until 6 PM. Unknown calldata and message signatures are forbidden.”

The agent should then be able to:

- Inspect its available authority
- Propose a valid payment intent
- Receive a deterministic policy decision
- Request approval when necessary
- Execute without approval when explicitly allowed
- Observe the transaction lifecycle
- Recover safely from retries or partial failures

At no point should the agent receive the owner’s unrestricted key or be able to bypass the authorization path through an alternate tool call.

---

## 6. Product Principles

### 6.1 Authority must be bounded

Every agent credential must have less authority than or equal to its owner. Unlimited agent authority is not an MVP-supported configuration.

### 6.2 The user owns the policy

An agent may propose a policy but may not activate, expand, or weaken its own authority.

### 6.3 Autonomous does not mean unbounded

Crip’s autonomous mode permits execution within policy. It never disables hard budget, chain, expiry, revocation, or credential restrictions.

### 6.4 Deterministic software decides authorization

LLMs may explain, classify, and propose. They must not be the final policy evaluator.

### 6.5 Intent and execution must match

A human-readable explanation is insufficient. The approved intent must be bound to the exact chain, wallet, recipient, amount, calldata, gas ceiling, nonce strategy, policy version, and expiry.

### 6.6 Deny unknown authority

Unknown calldata, unrecognized signatures, opaque proxies, unlimited approvals, and unsupported account capabilities must default to denial or explicit human review.

### 6.7 Enforcement strength must be visible

Crip must distinguish:

- On-chain enforced
- Signer enforced
- Control-plane enforced
- Advisory only

The UI and API must not imply that all adapters provide equal guarantees.

### 6.8 Every financial action must be traceable

The system must correlate intent, policy evaluation, approval, signature, broadcast, confirmation, and reconciliation.

### 6.9 Safe failure is more important than convenience

When simulation, RPC, decoding, price data, policy state, or budget state is ambiguous, the system must fail closed.

### 6.10 Local-first testing

Real funds are prohibited until all specified test gates are passed and the product owner explicitly approves a production canary phase.

---

## 7. Goals

### 7.1 MVP goals

The MVP must:

1. Run entirely against a local Anvil EVM chain.
2. Use deterministic disposable accounts and fake tokens.
3. Support one owner, one agent, one wallet, one chain, and one mock ERC-20 asset.
4. Support read-only, review-required, and autonomous-within-policy modes.
5. Enforce a total delegated budget and a per-transaction limit.
6. Enforce chain, asset, recipient, contract, and action restrictions.
7. Reserve budget atomically before signature authorization.
8. Prevent duplicate and concurrent requests from overspending.
9. Construct transactions from canonical intents.
10. Decode and verify the constructed transaction against the intent.
11. Simulate every state-changing operation before authorization.
12. Bind human approval to an immutable execution envelope.
13. Keep the owner key outside the agent process.
14. Expose a minimal MCP interface, CLI, and local dashboard.
15. Produce OpenTelemetry-compatible lifecycle traces.
16. Persist an append-only audit history.
17. Support immediate agent revocation and system pause.
18. Pass unit, integration, end-to-end, invariant, concurrency, and adversarial tests.
19. Include a documented adapter interface and local reference adapter.
20. Be cleanly structured so Safe and other wallet adapters can be added without changing the core policy model.

### 7.2 Post-MVP goals

After the local MVP, Crip should:

- Operate on an EVM testnet
- Integrate Safe as the first production-grade smart-account adapter
- Add a MetaMask Agent Wallet adapter
- Add signer-backed adapters such as Turnkey
- Add WalletConnect-compatible approval-only connections
- Publish an adapter conformance suite
- Publish a portable policy schema
- Package a standards-compatible Agent Skill
- Support multi-agent and multi-wallet policy isolation
- Provide mobile-friendly approvals
- Support hosted and self-hosted deployments

---

## 8. Non-Goals and Out of Scope

The following are out of scope for the local MVP:

- Mainnet transactions
- Real cryptocurrency
- The product owner’s existing MetaMask wallet
- Seed-phrase import for real wallets
- Fiat custody, fiat transfers, banking, cards, or exchange functionality
- Brokerage, investment advice, portfolio optimization, or promised returns
- Tax calculation
- Cross-chain bridges
- Token swaps
- DeFi lending, borrowing, staking, perpetuals, prediction markets, or yield vaults
- NFTs
- Solana, Bitcoin, Tron, Cosmos, or non-EVM chains
- Arbitrary raw transaction execution by default
- Arbitrary `personal_sign`
- Arbitrary EIP-712 typed-data signing
- Permit2
- Unlimited ERC-20 approvals
- `setApprovalForAll`
- `delegatecall`
- Proxy upgrade administration
- Contract ownership transfers
- Account recovery
- Social recovery
- Hardware-wallet support
- Production mobile applications
- Hosted TEE or MPC custody built by Crip
- KYC, AML, sanctions screening, or regulated custody claims
- Formal smart-contract audit certification
- Production insurance or transaction guarantees
- A marketplace of third-party skills
- A universal price oracle
- Autonomous policy expansion
- Automatic production deployment without owner approval

These may be reconsidered only through explicit phased planning and ADR review.

---

## 9. Users and Personas

### 9.1 Agent builder

Needs a safe, simple interface that lets an agent query authority and request transactions without handling wallet internals.

### 9.2 Wallet owner

Needs understandable policy controls, approval requests, emergency revocation, and evidence of what happened.

### 9.3 Security reviewer

Needs deterministic rules, immutable decision evidence, threat coverage, dependency visibility, and reproducible tests.

### 9.4 Wallet-provider integrator

Needs a stable adapter SDK, capability manifest, conformance tests, and clear enforcement semantics.

### 9.5 Operator

Needs health status, transaction state, failed-job recovery, telemetry, and clean operational controls.

### 9.6 Open-source contributor

Needs a modular repository, contribution rules, issue boundaries, test fixtures, architectural documentation, and clean source control.

---

## 10. Core Terminology

### Owner

The human or organization that controls the root wallet authority and defines agent permissions.

### Agent

An AI system or automated process that proposes and may execute actions through Crip.

### Agent credential

A restricted credential used to authenticate an agent to Crip or a signer backend. It must not be the owner’s unrestricted private key.

### Wallet

The on-chain account whose authority is being managed.

### Wallet adapter

A provider-specific implementation that constructs, authorizes, signs, submits, or monitors transactions through a wallet backend.

### Intent

A canonical, provider-neutral description of the operation an agent wants to perform.

### Execution envelope

The immutable, hashable representation of the exact transaction and constraints approved for execution.

### Policy

A versioned set of deterministic authorization rules.

### Budget

The maximum economic authority allocated to an agent.

### Reservation

A temporary atomic reduction in available budget while an authorized transaction is pending.

### Approval

A human authorization bound to an execution envelope.

### Enforcement grade

The strongest layer at which a rule is guaranteed: on-chain, signer, control plane, or advisory.

### Reconciliation

The process that converts a pending reservation into final spent value or releases it after failure.

### Simulation

Execution against a non-committing environment to predict reverts and asset or state changes.

---

## 11. Product Modes

### 11.1 Read-only mode

Permitted:

- Read wallet address
- Read chain and asset balances
- Read policy and capability summary
- Read transaction status
- Read audit records allowed to the agent

Prohibited:

- Create an approval request
- Reserve budget
- Sign
- Broadcast

### 11.2 Review-required mode

Every state-changing action must:

1. Produce a canonical intent.
2. Pass initial policy validation.
3. Be constructed and decoded.
4. Be simulated.
5. Produce an execution envelope.
6. Reserve budget if applicable.
7. Enter `AWAITING_APPROVAL`.
8. Receive valid owner approval.
9. Revalidate policy, budget, nonce, and expiry.
10. Sign and broadcast.

### 11.3 Autonomous-within-policy mode

The agent may execute without per-action human approval only when all hard requirements pass.

Hard requirements remain active:

- Total budget
- Per-transaction maximum
- Rolling-window maximum, when configured
- Chain allowlist
- Asset allowlist
- Recipient allowlist
- Contract allowlist
- Function allowlist
- Expiry
- Credential validity
- System and wallet pause
- Simulation success
- Intent-to-transaction verification
- Signature restrictions
- Risk policy
- Adapter enforcement capability requirements

There is no MVP “disable all guardrails” mode.

### 11.4 Owner break-glass mode

Future administrative capability, not an agent mode.

It may allow a human owner to override a policy after strong authentication and explicit warning. The agent must never invoke or activate it. It is out of scope for MVP.

---

## 12. High-Level Architecture

```text
┌──────────────────────────────────────────────────────────┐
│ Agent Hosts: Codex, Claude Code, AgentOS, other clients │
└─────────────────────────┬────────────────────────────────┘
                          │ MCP / CLI / SDK / Skill
┌─────────────────────────▼────────────────────────────────┐
│ Agent Gateway                                              │
│ Authentication, rate limits, schema validation, tenancy   │
└─────────────────────────┬────────────────────────────────┘
                          │ Canonical Intent
┌─────────────────────────▼────────────────────────────────┐
│ Intent Service                                             │
│ Normalize, validate, assign idempotency and correlation   │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│ Policy and Authorization Engine                            │
│ Deterministic rule evaluation and capability requirements │
└───────────────┬─────────────────────────┬──────────────────┘
                │                         │
                │                 ┌───────▼────────┐
                │                 │ Budget Ledger  │
                │                 │ Atomic reserve │
                │                 └───────┬────────┘
                │                         │
┌───────────────▼─────────────────────────▼──────────────────┐
│ Transaction Pipeline                                       │
│ Build → decode → verify → simulate → risk evaluate         │
└─────────────────────────┬──────────────────────────────────┘
                          │ Execution Envelope
┌─────────────────────────▼──────────────────────────────────┐
│ Approval Service                                           │
│ Human decision, cryptographic binding, expiry, audit       │
└─────────────────────────┬──────────────────────────────────┘
                          │ Authorized Envelope
┌─────────────────────────▼──────────────────────────────────┐
│ Wallet Adapter                                             │
│ Capability check, signer enforcement, submit, monitor      │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────┐
│ Chain / Wallet Provider                                    │
└─────────────────────────┬──────────────────────────────────┘
                          │ Receipt / state
┌─────────────────────────▼──────────────────────────────────┐
│ Confirmation and Reconciliation                            │
│ Final spend, release, retry classification, audit closure  │
└────────────────────────────────────────────────────────────┘

Cross-cutting:
- OpenTelemetry
- Append-only audit log
- Secrets and credential management
- Health and readiness
- Pause and revocation controls
```

### 12.1 Architectural rule

No interface may implement its own authorization logic.

MCP, CLI, dashboard, REST, SDK, and background workers must all call the same core authorization services.

---

## 13. Trust Boundaries

### 13.1 Untrusted components

Treat the following as potentially malicious or compromised:

- The LLM
- Agent prompts
- Agent skills
- MCP client
- MCP tool arguments
- Browser input
- External RPC responses
- Token metadata
- ABI metadata
- Price feeds
- Wallet-provider webhooks
- Third-party risk-provider responses
- Relayers and bundlers
- External dApps
- User-provided contract addresses

### 13.2 Trusted computing base for MVP

The MVP trusted computing base includes:

- Core intent schema validator
- Policy evaluator
- Budget ledger transaction logic
- Execution-envelope hasher
- Approval verifier
- Local wallet adapter
- Local chain configuration
- Database integrity controls
- Secrets boundary
- Audit event writer

The goal is to keep this base small, deterministic, and heavily tested.

### 13.3 Key isolation

The owner key must not be:

- Provided to the LLM
- Returned through MCP
- Logged
- Stored in prompts
- Placed in repository files
- Passed as a CLI argument
- Embedded in screenshots or fixtures
- Exposed to the dashboard frontend

For local MVP, key material may be deterministic disposable test material generated specifically for Anvil. Production key-management design remains a later phase.

---

## 14. Threat Model

### 14.1 Threat actors

- Malicious agent
- Hallucinating or malfunctioning agent
- Prompt-injected agent
- Compromised MCP client
- Compromised UI session
- Malicious wallet adapter
- Malicious RPC
- Malicious contract
- Malicious or incorrect ABI
- Compromised dependency
- Insider with partial access
- Attacker replaying prior approvals
- Attacker racing concurrent transactions
- Attacker changing policy during execution

### 14.2 Required threat scenarios

The implementation and test suite must cover:

- Spending above the total allocation
- Splitting an overspend into multiple transactions
- Concurrent overspend
- Duplicate intent retries
- Duplicate broadcasts
- Approval replay
- Chain substitution
- Recipient substitution
- Amount substitution
- Asset substitution
- Calldata substitution
- Gas-ceiling bypass
- Policy downgrade or stale-policy execution
- Expired approval use
- Revoked credential use
- Wallet pause bypass
- Global pause bypass
- Unlimited token approval
- Permit or Permit2 authorization
- Unknown typed-data signature
- `personal_sign`
- `delegatecall`
- Multicall hiding disallowed operations
- Proxy target changes
- Token-decimal manipulation
- Fee spikes
- Reorgs
- RPC disagreement
- Simulation and execution divergence
- Timeout after signature but before response
- Timeout after broadcast but before persistence
- Malicious webhook
- Database retry and double reservation
- Reservation leak
- Price-feed staleness
- Audit-log tampering

### 14.3 Threat-model maintenance

Every feature that expands signing, protocol interaction, supported chains, custody, or autonomy must update the threat model before implementation is accepted.

---

## 15. Canonical Intent Model

### 15.1 Intent requirements

An intent must be:

- Typed
- Versioned
- Strictly schema-validated
- Idempotent
- Bound to one agent
- Bound to one wallet
- Bound to one chain
- Time-limited
- Human-readable
- Machine-verifiable
- Independent of wallet provider

### 15.2 MVP intent types

- `wallet.read_state`
- `asset.transfer`

No generic arbitrary contract call is required for MVP.

### 15.3 Example transfer intent

```json
{
  "schemaVersion": "1.0",
  "intentId": "int_01H...",
  "idempotencyKey": "merchant-payment-2026-08-06-001",
  "agentId": "agent_local_01",
  "walletId": "wallet_local_01",
  "chainId": "eip155:31337",
  "action": "asset.transfer",
  "objective": "Pay the approved local merchant for the test invoice",
  "asset": {
    "type": "erc20",
    "address": "0x...",
    "symbolHint": "TEST_USDC",
    "decimalsHint": 6
  },
  "amount": {
    "atomic": "500000",
    "displayHint": "0.5"
  },
  "recipient": "0x...",
  "maximumNetworkFee": {
    "asset": "native",
    "atomic": "1000000000000000"
  },
  "notBefore": "2026-08-06T15:00:00Z",
  "expiresAt": "2026-08-06T15:10:00Z",
  "metadata": {
    "externalReference": "invoice-test-001"
  }
}
```

### 15.4 Validation rules

- Unknown top-level fields must be rejected unless the schema version explicitly permits them.
- Amounts must use integer atomic units. Floating-point arithmetic is prohibited.
- Token symbol and decimals supplied by an agent are hints only.
- Asset identity and decimals must be resolved from trusted configuration or verified on-chain.
- Addresses must be checksummed or normalized consistently.
- Chain ID must use CAIP-2 format at the API boundary.
- Expiry must be bounded by configured maximum intent lifetime.
- Idempotency key reuse with a different payload must return a conflict.
- Intent IDs must be immutable.

---

## 16. Execution Envelope

The execution envelope is the exact object that policy and approval bind to after construction and simulation.

It must include:

- Intent ID
- Intent hash
- Agent ID
- Wallet ID
- Adapter ID and version
- Chain ID
- From address
- To address
- Value
- Calldata
- Decoded function
- Decoded arguments
- Expected asset deltas
- Simulation block reference
- Simulation result hash
- Nonce strategy
- Gas limit
- Maximum fee constraints
- Policy ID and version
- Policy decision hash
- Budget reservation ID
- Creation time
- Expiry
- Risk decision
- Approval requirement
- Envelope hash

Any change to one of these values creates a new envelope and invalidates prior approval.

---

## 17. Policy Model

### 17.1 Policy properties

Policies must be:

- Versioned
- Immutable after activation
- Hashable
- Auditable
- Deterministically evaluated
- Deny-by-default
- Independently testable
- Bound to agent and wallet
- Explicit about enforcement requirements

Editing a policy creates a new version. Existing pending operations remain bound to the older version and must be revalidated before signing.

### 17.2 MVP policy fields

```yaml
schemaVersion: "1.0"
policyId: policy_local_agent_01
version: 1
status: active

subject:
  agentId: agent_local_01
  walletId: wallet_local_01

mode: autonomous-within-policy

validity:
  notBefore: "2026-08-06T00:00:00Z"
  expiresAt: "2026-08-07T00:00:00Z"

chains:
  allow:
    - eip155:31337

assets:
  allow:
    - chainId: eip155:31337
      type: erc20
      address: "0x..."

recipients:
  allow:
    - "0x..."

actions:
  allow:
    - asset.transfer

budgets:
  total:
    assetAddress: "0x..."
    atomic: "2000000"
  perTransaction:
    atomic: "500000"

networkFees:
  maximumPerTransactionAtomic: "1000000000000000"

signatures:
  personalSign: deny
  typedData: deny
  rawDigest: deny

transactions:
  requireSimulation: true
  denyUnknownCalldata: true
  denyDelegatecall: true
  denyUnlimitedApprovals: true

enforcement:
  minimumBudgetGrade: control-plane
  minimumRecipientGrade: control-plane
```

### 17.3 Policy decision

A policy evaluation returns:

```json
{
  "decision": "ALLOW_AUTONOMOUS",
  "policyId": "policy_local_agent_01",
  "policyVersion": 1,
  "evaluatedAt": "2026-08-06T15:01:00Z",
  "rules": [
    {
      "rule": "chain.allowlist",
      "result": "pass"
    },
    {
      "rule": "budget.per_transaction",
      "result": "pass",
      "limitAtomic": "500000",
      "requestedAtomic": "500000"
    }
  ],
  "requiredEnforcement": {
    "budget": "control-plane"
  },
  "decisionHash": "0x..."
}
```

Decision states:

- `ALLOW_READ`
- `ALLOW_AUTONOMOUS`
- `REQUIRE_APPROVAL`
- `DENY`
- `INDETERMINATE`

`INDETERMINATE` must fail closed.

### 17.4 Policy expansion controls

An agent may not:

- Increase a limit
- Extend expiry
- Add a chain
- Add an asset
- Add a recipient
- Add a contract
- Enable a signature type
- Lower a required enforcement grade
- Unpause itself

Policy reductions may be owner-initiated and should take effect immediately where safe.

---

## 18. Budget Ledger and Reservations

### 18.1 Budget invariant

For each agent-wallet-asset-policy tuple:

```text
allocated = available + reserved + finalized_spend + released_or_expired_adjustments
```

The implementation must define the exact accounting equation and test it under all state transitions.

### 18.2 No floating-point monetary values

All ledger values must use integers in atomic asset units.

USD-equivalent budgets are out of scope for MVP because they introduce oracle and price-staleness risk.

### 18.3 Reservation lifecycle

A reservation can be:

- `HELD`
- `AUTHORIZED`
- `BROADCAST`
- `FINALIZED`
- `RELEASED`
- `EXPIRED`
- `DISPUTED`

A reservation must be created in the same serializable database transaction that verifies remaining budget.

### 18.4 Concurrency requirements

Two requests must not both reserve the same available funds.

The implementation must use one of:

- Serializable transactions
- Row-level locking with proven invariants
- Optimistic concurrency with version checks and bounded retry

The chosen method must have explicit concurrency tests.

### 18.5 Idempotency

The same idempotency key and same payload returns the original intent and state.

The same idempotency key with a different payload returns a conflict and must not mutate budget.

### 18.6 Reconciliation

After confirmation:

- Determine actual transferred amount from receipt and trusted decoding.
- Convert reservation to finalized spend.
- Release unused network-fee reservation, if fee budgeting is implemented.
- Record discrepancies.
- Mark ambiguous outcomes `DISPUTED`.
- Never silently assume a timed-out transaction failed.

---

## 19. Transaction Lifecycle

### 19.1 State machine

```text
DRAFT
  → VALIDATED
  → POLICY_PRECHECKED
  → CONSTRUCTED
  → DECODED
  → SIMULATED
  → POLICY_FINALIZED
  → BUDGET_RESERVED
  → AWAITING_APPROVAL | AUTHORIZED
  → SIGNING
  → SIGNED
  → BROADCAST
  → PENDING_CONFIRMATION
  → CONFIRMED
  → RECONCILED
```

Terminal or exceptional states:

- `REJECTED`
- `DENIED`
- `EXPIRED`
- `SIMULATION_FAILED`
- `SIGNING_FAILED`
- `BROADCAST_FAILED`
- `REVERTED`
- `CANCELLED`
- `DISPUTED`
- `REVOKED`

### 19.2 Transition rules

- Every transition must be explicit and audited.
- Invalid transitions must be rejected.
- Retried workers must be idempotent.
- A signed transaction must never be reconstructed with different calldata.
- A timeout must not be treated as proof of failure.
- Broadcast recovery must search by known hash and nonce.
- Policy, pause, expiry, and credential state must be rechecked immediately before signing.
- Approval must be revalidated immediately before signing.

### 19.3 Asynchronous operation

Long-running actions must return an operation ID.

The agent may poll status without retaining a long blocking tool call.

---

## 20. Transaction Construction, Decoding, and Verification

### 20.1 Builder ownership

Crip, not the LLM, constructs the MVP ERC-20 transfer calldata.

### 20.2 Verification

After construction, Crip must independently decode the transaction and verify:

- Function selector is the approved transfer function.
- Recipient equals the intent recipient.
- Amount equals the intent amount.
- Token contract equals the policy-approved asset.
- No native value is unexpectedly attached.
- Chain equals the intent chain.
- Sender equals the expected wallet.
- No additional calls are present.

### 20.3 Raw calldata

Raw calldata submission is out of scope for MVP.

Future support must be an explicit expert capability with mandatory decoding, simulation, elevated review, and policy restrictions.

---

## 21. Simulation and Risk Evaluation

### 21.1 Mandatory simulation

All state-changing MVP transactions must be simulated against the target local chain state.

### 21.2 Simulation output

The normalized result must include:

- Success or revert
- Revert reason when available
- Gas estimate
- Native asset delta
- ERC-20 asset deltas
- Contract calls
- State-change summary where feasible
- Block number and hash
- Simulator version
- Result hash

### 21.3 Divergence handling

If execution preconditions change after simulation, the transaction must be re-simulated before signing.

### 21.4 Risk providers

The risk-engine interface must be pluggable.

MVP may include deterministic local checks only:

- Unknown contract
- Disallowed selector
- Unexpected value
- Unlimited approval
- Unrecognized asset
- Recipient mismatch

External risk services such as Blockaid are future integrations, not mandatory dependencies.

---

## 22. Human Approval

### 22.1 Approval request contents

The approval UI must show:

- Agent identity
- Agent objective
- Wallet
- Chain
- Asset
- Amount
- Recipient
- Recipient label, if trusted
- Network-fee ceiling
- Decoded function
- Simulation result
- Expected before and after balances
- Policy rules triggered
- Risk flags
- Expiry
- Enforcement grade
- Exact envelope hash or fingerprint

### 22.2 Approval binding

Approval must bind to the execution-envelope hash.

Changing any executable field invalidates approval.

### 22.3 Approval states

- `PENDING`
- `APPROVED`
- `REJECTED`
- `EXPIRED`
- `REVOKED`
- `CONSUMED`

An approval may be consumed only once.

### 22.4 MVP authentication

For local MVP, owner approval may use a local authenticated session plus a test signing key. The exact mechanism must be documented in an ADR.

It must not be represented as production-grade identity security.

---

## 23. Wallet Adapter Architecture

### 23.1 Adapter responsibilities

A wallet adapter may implement:

- Wallet discovery
- Capability reporting
- Address resolution
- Transaction construction support
- Signature authorization
- Broadcast
- Status monitoring
- Receipt normalization
- Provider-specific policy installation
- Revocation
- Health checks

### 23.2 Adapter capability manifest

Every adapter must expose a machine-readable manifest:

```yaml
adapter:
  id: local-anvil
  version: 0.1.0

chains:
  - eip155:31337

custody:
  model: disposable-local-test-key
  ownerKeyExposedToAgent: false

operations:
  readState: true
  erc20Transfer: true
  arbitraryCall: false
  typedData: false

enforcement:
  totalBudget: control-plane
  perTransactionBudget: control-plane
  chainAllowlist: control-plane
  recipientAllowlist: control-plane
  functionAllowlist: control-plane
  expiry: control-plane

approvals:
  asynchronous: true

simulation:
  supported: true
```

### 23.3 Enforcement grades

Ordered strongest to weakest:

1. `ONCHAIN`
2. `SIGNER`
3. `CONTROL_PLANE`
4. `ADVISORY`
5. `UNSUPPORTED`

A policy may require a minimum grade. The adapter must be rejected when it cannot satisfy that requirement.

### 23.4 MVP adapter

The local Anvil adapter is the only required MVP adapter.

It must not be used as evidence that production key custody is solved.

### 23.5 Planned adapters

Recommended sequence:

1. Safe smart account and allowance/delegation
2. MetaMask Agent Wallet
3. Turnkey delegated signer
4. Privy or comparable embedded-wallet signer
5. Coinbase agent wallet
6. WalletConnect approval adapter
7. Additional EVM smart accounts
8. Non-EVM families after separate architecture review

---

## 24. Agent Interfaces

### 24.1 Interface rule

Agent-facing interfaces expose capability and workflow, not unrestricted signing primitives.

### 24.2 MVP MCP tools

Recommended minimal MCP surface:

#### `crip_wallet_get_state`

Returns:

- Agent identity
- Wallet identity
- Mode
- Chain
- Balances
- Available and reserved budget
- Policy summary
- Adapter capability summary
- Pause or revocation state

Read-only.

#### `crip_wallet_prepare_transfer`

Creates and evaluates a canonical transfer intent.

Returns:

- Intent ID
- Operation ID
- Decision
- Required approval state
- Human-readable summary
- Structured denial reasons
- Expiry

Does not accept arbitrary calldata.

#### `crip_wallet_execute`

Requests execution of an already prepared, authorized intent.

Must be idempotent.

#### `crip_wallet_get_operation`

Returns the lifecycle state and safe structured details.

#### `crip_wallet_cancel`

Cancels an eligible pending intent or approval. It cannot guarantee cancellation after broadcast.

#### `crip_wallet_list_capabilities`

Returns supported operations and enforcement grades.

### 24.3 MCP security requirements

- Treat all tool arguments as untrusted.
- Require explicit agent authentication.
- Do not rely on implicit connection state.
- Validate every field server-side.
- Rate-limit state-changing tools.
- Return structured errors.
- Never include secrets in tool results.
- Mark state-changing behavior accurately.
- Use operation IDs for asynchronous work.
- Propagate trace context where supported.

### 24.4 CLI

The CLI must support:

- Human-readable mode
- Strict JSON mode
- Non-interactive operation
- Explicit environment selection
- Safe defaults
- No secret values in command history
- Stable exit codes
- Clear warnings for test-only environments

Example command family:

```text
crip init
crip status
crip policy show
crip intent prepare-transfer
crip operation get
crip approval list
crip approval approve
crip approval reject
crip agent revoke
crip system pause
crip system resume
```

### 24.5 SDK

A TypeScript SDK may wrap the HTTP/core API after the core interfaces stabilize.

### 24.6 Agent Skill

The project should ship an Agent Skills-compatible package.

It must:

- Keep `SKILL.md` concise
- Use progressive disclosure
- Route detailed instructions to `references/`
- Never instruct an agent to bypass policy
- Never request seed phrases
- Clearly distinguish prepare, approve, and execute
- Explain asynchronous polling
- Include safe failure behavior
- Be version-pinned to compatible Crip APIs
- Have behavior evaluations

The skill is an agent usability layer, not a security boundary.

---

## 25. Dashboard Product Specification

### 25.1 MVP dashboard surfaces

#### Overview

- System status
- Wallet address
- Current chain
- Agent status
- Mode
- Available budget
- Reserved budget
- Finalized spend
- Recent operations
- Pause status

#### Agents

- Agent identity
- Credential status
- Assigned wallet
- Assigned policy
- Last activity
- Revoke action

#### Policies

- Active policy
- Policy version
- Human-readable rules
- Enforcement grades
- Expiry
- Read-only history

Policy editing may be limited in MVP. Seeded policy configuration is acceptable if the UI accurately presents it.

#### Approvals

- Pending approvals
- Full transaction summary
- Simulation
- Policy decision
- Approve
- Reject
- Expiry

#### Operations

- Lifecycle timeline
- Intent
- Envelope fingerprint
- Transaction hash
- Receipt
- Reconciliation status
- Failure classification

#### Audit

- Filterable append-only events
- Correlation by intent, operation, agent, wallet, policy, and transaction hash

#### Emergency controls

- Pause system
- Pause wallet
- Revoke agent
- Reject all pending approvals

### 25.2 UX requirements

- Dangerous actions require explicit confirmation.
- Buttons must describe the actual effect.
- Approval must not use deceptive defaults.
- Testnet/local environment must be visually obvious.
- Enforcement grades must be understandable.
- No raw private key or mnemonic display.
- Errors must state whether funds may already have moved.
- Transaction status must not report “failed” when the state is unknown.

---

## 26. Persistence and Data Model

The MVP should use a transactional relational database. PostgreSQL is preferred; SQLite may be used only if concurrency and locking requirements are demonstrably satisfied.

### 26.1 Required entities

- `owners`
- `agents`
- `agent_credentials`
- `wallets`
- `wallet_adapters`
- `policies`
- `policy_versions`
- `intents`
- `execution_envelopes`
- `policy_decisions`
- `budget_accounts`
- `budget_reservations`
- `approval_requests`
- `approval_decisions`
- `operations`
- `transactions`
- `transaction_receipts`
- `audit_events`
- `system_controls`
- `wallet_controls`
- `agent_controls`
- `idempotency_records`

### 26.2 Data integrity requirements

- Foreign keys required.
- Monetary atomic values stored as integer-compatible decimal strings or numeric types with no fractional interpretation.
- Unique idempotency constraints.
- Unique one-time approval consumption.
- Immutable policy-version records.
- Immutable execution envelopes.
- Append-only audit-event semantics.
- Optimistic version or locking field for mutable lifecycle entities.
- UTC timestamps.
- Explicit status enums or check constraints.
- Database migrations committed and tested.

### 26.3 Audit event shape

```json
{
  "eventId": "evt_...",
  "eventType": "budget.reservation.created",
  "occurredAt": "2026-08-06T15:01:05Z",
  "actorType": "system",
  "actorId": "policy-engine",
  "ownerId": "owner_local_01",
  "agentId": "agent_local_01",
  "walletId": "wallet_local_01",
  "intentId": "int_...",
  "operationId": "op_...",
  "policyId": "policy_local_agent_01",
  "policyVersion": 1,
  "traceId": "...",
  "data": {
    "reservationId": "res_...",
    "assetAddress": "0x...",
    "amountAtomic": "500000"
  },
  "previousEventHash": "0x...",
  "eventHash": "0x..."
}
```

A hash chain is desirable for tamper evidence but does not replace secure storage or access control.

---

## 27. Authentication and Authorization

### 27.1 Identity classes

- Owner session
- Agent credential
- Service identity
- Background worker identity
- Adapter credential

### 27.2 Agent authentication

Agent credentials must be:

- Unique per agent
- Revocable
- Expiring or rotatable
- Scoped
- Hashed or protected at rest
- Never logged
- Rate limited
- Bound to an agent identity

### 27.3 Owner authentication

The local MVP may use a local-only owner login and test signing mechanism.

Production owner identity, passkeys, mobile approval, or external wallet signatures are future work.

### 27.4 Service authorization

Internal services must not trust caller-provided identity fields. Identity must come from authenticated context.

---

## 28. Secrets and Key Management

### 28.1 MVP

- Use disposable Anvil keys only.
- Store them outside source control.
- Provide `.env.example` without secrets.
- Refuse startup when an unsafe environment configuration is detected.
- Print a prominent local-test-only warning.
- Support deterministic fixtures for tests without exposing production patterns.

### 28.2 Production direction

Crip should prefer:

- Smart-account delegation
- Provider signer policies
- Hardware-backed or enclave-backed signing
- Session keys
- Passkeys
- External wallet approval

Crip should avoid becoming a general-purpose hot-wallet key vault unless a later, separately audited architecture explicitly chooses that scope.

---

## 29. Observability

### 29.1 Trace model

One trace should follow:

```text
agent request
→ intent validation
→ policy precheck
→ transaction construction
→ decoding
→ simulation
→ final policy evaluation
→ budget reservation
→ approval
→ signing
→ broadcast
→ confirmation
→ reconciliation
```

### 29.2 Required span attributes

Where safe:

- `crip.intent.id`
- `crip.operation.id`
- `crip.agent.id`
- `crip.wallet.id`
- `crip.adapter.id`
- `crip.chain.id`
- `crip.action`
- `crip.policy.id`
- `crip.policy.version`
- `crip.policy.decision`
- `crip.approval.required`
- `crip.reservation.id`
- `crip.transaction.hash`
- `crip.lifecycle.state`
- `crip.failure.class`

Do not attach private keys, tokens, complete prompts, or sensitive approval secrets.

### 29.3 Metrics

- Intents created
- Policy allows, approvals, denials, and indeterminate results
- Reservations created, finalized, released, expired, disputed
- Approval latency
- Signing latency
- Confirmation latency
- Simulation failures
- Broadcast retries
- Duplicate request rate
- Reconciliation discrepancies
- Revocation events
- Paused-operation blocks
- Adapter errors
- RPC disagreement count

### 29.4 Logs

Logs must be structured and correlated. Sensitive data redaction is mandatory.

### 29.5 Health endpoints

- Liveness
- Readiness
- Database
- Local chain/RPC
- Adapter
- Worker queue, if present
- Migration state

Health must not leak secrets.

---

## 30. Error Model

Errors must have:

- Stable code
- Human-readable message
- Retryability
- Lifecycle state
- Whether funds may have moved
- Safe next action
- Correlation ID

Example categories:

- `INVALID_INTENT`
- `IDEMPOTENCY_CONFLICT`
- `POLICY_DENIED`
- `POLICY_INDETERMINATE`
- `INSUFFICIENT_BUDGET`
- `APPROVAL_REQUIRED`
- `APPROVAL_EXPIRED`
- `AGENT_REVOKED`
- `SYSTEM_PAUSED`
- `ADAPTER_UNSUPPORTED`
- `SIMULATION_FAILED`
- `EXECUTION_DIVERGENCE`
- `SIGNING_FAILED`
- `BROADCAST_UNKNOWN`
- `CHAIN_REORG`
- `RECONCILIATION_DISPUTED`

---

## 31. Source-Control and Engineering Quality Clause

This section is mandatory for every contributor and implementation agent.

### 31.1 Clean source control

The repository must remain clean and reviewable.

Contributors MUST:

- Inspect the repository before editing.
- Work from the latest intended base branch.
- Use focused branches or isolated worktrees when multiple agents work concurrently.
- Avoid overlapping ownership of the same files without explicit coordination.
- Make atomic commits that represent one coherent change.
- Write descriptive imperative commit messages.
- Include tests and documentation with the change that requires them.
- Keep generated files out of commits unless they are intentionally versioned.
- Never commit secrets, local databases, wallet material, build output, logs, traces, screenshots containing secrets, or temporary artifacts.
- Never rewrite shared history or force-push without explicit owner instruction.
- Never use broad formatting changes to hide functional edits.
- Never commit unrelated cleanup with a security-critical change.
- Keep migrations ordered, forward-only, and reproducible.
- Preserve attribution and license requirements.
- Run the relevant test and quality gates before committing.
- Record the exact verification performed.
- Update changelog, decisions, and plan status when required.

Contributors MUST NOT:

- Bypass hooks or CI merely to make a change appear green.
- Mark tests skipped without a documented reason.
- weaken assertions to accommodate broken behavior.
- silence errors without resolving or classifying them.
- add unreviewed dependencies casually.
- introduce duplicate abstractions or dead paths.
- create speculative framework bloat outside the selected milestone.
- claim completion without execution evidence.

### 31.2 Code quality

Code must be:

- Typed
- Modular
- Explicit about errors
- Deterministic in authorization paths
- Free of floating-point financial arithmetic
- Tested at the correct layer
- Documented where the security model is non-obvious
- Small enough to review
- Consistent with repository conventions

Security-critical code should favor clarity over cleverness.

### 31.3 Pull-request quality

Every pull request must include:

- Problem statement
- Scope
- Files and modules changed
- Security implications
- Acceptance criteria
- Tests run and results
- Known limitations
- Migration or compatibility impact
- Documentation updates
- Rollback or recovery notes when relevant

---

## 32. Repository Architecture

Recommended monorepo structure:

```text
/
├── apps/
│   ├── api/
│   ├── dashboard/
│   ├── mcp-server/
│   └── cli/
├── packages/
│   ├── schemas/
│   ├── core/
│   ├── policy-engine/
│   ├── budget-ledger/
│   ├── transaction-pipeline/
│   ├── simulation/
│   ├── approvals/
│   ├── adapter-sdk/
│   ├── telemetry/
│   ├── audit/
│   └── test-kit/
├── adapters/
│   └── local-anvil/
├── contracts/
│   ├── mock-token/
│   └── future-policy-modules/
├── skills/
│   └── crip-wallet/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── invariants/
│   ├── adversarial/
│   ├── concurrency/
│   └── adapter-conformance/
├── docs/
│   ├── PRODUCT_SPEC.md
│   ├── ARCHITECTURE.md
│   ├── THREAT_MODEL.md
│   ├── SECURITY.md
│   ├── TESTING.md
│   ├── ROADMAP.md
│   ├── CHANGELOG.md
│   ├── PROJECT_STATE.md
│   ├── RISK_REGISTER.md
│   ├── TEST_MATRIX.md
│   ├── decisions/
│   ├── plans/
│   └── workstreams/
├── tooling/
├── .github/
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
└── README.md
```

The orchestrator may adjust this structure through an ADR if repository evidence requires it.

---

## 33. Recommended Technical Direction

This is a preferred starting point, not an irrevocable mandate:

- TypeScript
- Node.js current supported LTS
- PostgreSQL
- A type-safe query or ORM layer with explicit transaction control
- Viem for EVM interaction
- Foundry/Anvil for chain and contract testing
- React/Next.js or equivalent for dashboard
- Zod or equivalent for runtime schema validation
- OpenTelemetry SDK
- Structured logger
- MCP TypeScript SDK
- Agent Skills-compatible files
- Workspace monorepo tooling
- Strict TypeScript
- ESLint and formatter
- Unit test runner plus Playwright for browser E2E

Any deviation must preserve the product invariants and be documented.

---

## 34. Testing Strategy

### 34.1 Unit tests

Required for:

- Intent validation
- Policy rules
- Policy-combination semantics
- Budget arithmetic
- State transitions
- Envelope hashing
- Approval verification
- Error mapping
- Adapter capability matching

### 34.2 Database integration tests

Required for:

- Atomic reservation
- Concurrent reservation
- Idempotency conflict
- One-time approval consumption
- Worker retry
- Immutable policy versions
- Audit append behavior
- Migration upgrade and rollback strategy

### 34.3 Chain integration tests

Required for:

- Mock token transfer
- Revert
- Insufficient token balance
- Insufficient native gas
- Receipt parsing
- Event decoding
- Transaction replacement, where feasible
- Confirmation polling
- Local reorg simulation, where feasible

### 34.4 End-to-end tests

Required journeys:

1. Read-only state query
2. Review-required approved transfer
3. Review-required rejected transfer
4. Autonomous allowed transfer
5. Per-transaction limit denial
6. Total budget denial
7. Recipient denial
8. Agent revocation
9. System pause
10. Duplicate request retry
11. Approval expiry
12. Simulation failure
13. Broadcast timeout recovery

### 34.5 Invariant and property tests

At minimum:

- Spend never exceeds allocation.
- Reserved plus spent never exceeds allocation.
- An approval can be consumed at most once.
- One idempotency key cannot represent two payloads.
- A revoked agent cannot sign.
- A paused system cannot authorize new state-changing actions.
- A changed envelope cannot use an old approval.
- Unknown policy results cannot allow execution.
- Invalid state transitions cannot occur.

### 34.6 Adversarial tests

Create malicious client fixtures that attempt every threat listed in the threat model.

### 34.7 Adapter conformance tests

Future adapters must pass common tests for:

- Capability accuracy
- Address identity
- Chain binding
- Signature restrictions
- Idempotent submission
- Receipt normalization
- Revocation
- Enforcement-grade claims
- Error classification

### 34.8 Coverage policy

Coverage percentages alone are not sufficient. Security invariants and critical branches must be explicitly enumerated in the test matrix.

### 34.9 No-real-funds gate

CI and local test commands must default to Anvil.

A test that can reach mainnet or use real keys must require an explicit, separately named configuration and must not be part of MVP.

---

## 35. Security Gates

### Gate S0 — Repository safety

- Secret scanning
- Dependency lockfile
- Code owners for security-critical modules
- Branch protections
- Vulnerability reporting instructions
- No real-wallet material

### Gate S1 — Core invariant proof

- Budget concurrency tests pass
- Idempotency tests pass
- Approval replay tests pass
- Revocation and pause tests pass
- No floating-point money paths

### Gate S2 — Local end-to-end

- All MVP journeys pass against clean Anvil startup
- Trace and audit evidence complete
- Recovery paths tested

### Gate S3 — Testnet readiness

- Threat model reviewed
- Safe or signer-enforced adapter
- Production-grade owner authentication design
- External security review plan
- No critical or high unresolved findings

### Gate S4 — Real-value canary

Out of MVP. Requires explicit product-owner approval, external review, tiny isolated funds, hard loss ceiling, and operational runbook.

---

## 36. Delivery Phases

## Phase 0 — Governance and repository foundation

### Objective

Create the project skeleton, source-of-truth documents, local development environment, and quality controls.

### Deliverables

- Repository scaffold
- Product spec installed at `docs/PRODUCT_SPEC.md`
- Architecture overview
- Threat model
- ADR process
- Project state
- Changelog
- Risk register
- Test matrix
- Contribution guide
- Security policy
- CI skeleton
- Anvil and PostgreSQL local environment
- Secret scanning and linting
- Initial issue/workstream plan

### Success criteria

- Fresh clone can install and run baseline checks.
- No real wallet is required.
- All governance files exist and agree.
- Ownership of security-critical modules is defined.
- Source-control rules are active.

---

## Phase 1 — Canonical core and local ledger

### Objective

Implement the provider-neutral domain model without signing.

### Deliverables

- Intent schema
- Policy schema
- Policy evaluator
- Operation state machine
- Budget accounts
- Atomic reservations
- Idempotency
- Audit events
- Core errors
- Unit and database concurrency tests

### Success criteria

- Concurrent requests cannot overspend.
- Policy decisions are deterministic.
- All monetary math uses atomic integers.
- Invalid transitions are rejected.
- Audit events correlate each decision.

---

## Phase 2 — Local EVM transaction pipeline

### Objective

Construct, decode, simulate, and execute fake ERC-20 transfers on Anvil.

### Deliverables

- Mock token
- Local wallet adapter
- Transfer builder
- Decoder and verifier
- Simulation
- Execution envelopes
- Signing boundary
- Broadcast and confirmation
- Reconciliation
- Chain integration tests

### Success criteria

- A valid transfer completes end to end.
- Mismatched calldata is rejected.
- Failed or ambiguous transactions reconcile safely.
- Owner key is not exposed to the agent interface.

---

## Phase 3 — Approval, controls, and operational safety

### Objective

Add human approval and emergency control paths.

### Deliverables

- Approval service
- Approval-bound envelope hashing
- Approval expiry and single consumption
- System, wallet, and agent pause
- Agent revocation
- Recovery workers
- Operational error states
- E2E test journeys

### Success criteria

- Review-required mode cannot execute without approval.
- Changed transactions invalidate approval.
- Revocation and pause are enforced immediately before signing.
- Retries do not duplicate execution.

---

## Phase 4 — Agent and user interfaces

### Objective

Expose the common core through MCP, CLI, dashboard, and an Agent Skill.

### Deliverables

- Minimal MCP server
- JSON-capable CLI
- Local dashboard
- Agent Skills package
- Structured operation polling
- Approval interface
- Audit timeline
- UX tests

### Success criteria

- All interfaces produce the same decisions for the same intent.
- No interface bypasses core authorization.
- Agent context remains compact.
- Human approval clearly presents actual execution.

---

## Phase 5 — Observability and adversarial hardening

### Objective

Prove the local MVP against the full security and reliability model.

### Deliverables

- OpenTelemetry traces
- Metrics and structured logs
- Adversarial suite
- Property tests
- Concurrency suite
- Fault injection
- Recovery evidence
- Complete test matrix
- MVP security review report

### Success criteria

- Core invariant suite passes.
- No unresolved critical or high findings.
- Every state-changing E2E run is traceable.
- Clean-room setup is reproducible.
- MVP exit criteria are satisfied.

---

## Phase 6 — First testnet adapter

### Status

Post-MVP.

### Preferred direction

Safe smart account with bounded allowance or delegation.

### Required additions

- Stronger owner authentication
- Testnet-only deployment controls
- Adapter conformance
- On-chain or signer enforcement
- Gas and relayer policy
- External security review
- Testnet runbook

---

## Phase 7 — Provider-neutral expansion

### Status

Future.

Potential adapters:

- MetaMask Agent Wallet
- Turnkey
- Privy
- Coinbase
- WalletConnect
- Other ERC-4337 or ERC-7579 accounts

The core schema and policy model must remain independent of provider-specific commands.

---

## Phase 8 — Advanced agent finance

### Status

Future and intentionally out of current scope.

Potential capabilities:

- Swaps
- Protocol allowlists
- Contract-call policies
- Typed-data permission analysis
- x402 payments
- Recurring payments
- Multi-agent consensus
- Organization treasuries
- Cross-chain operations
- Non-EVM chains
- Hosted signing and managed notifications

Each requires separate threat modeling and release gates.

---

## 37. MVP Release Definition

The project reaches “working MVP” only when all of the following are true:

- Runs from a clean clone using documented commands.
- Uses local Anvil and fake assets only.
- Supports one owner, agent, wallet, policy, chain, and token.
- Read-only, review-required, and autonomous-within-policy modes work.
- Total and per-transaction budgets are enforced under concurrency.
- Recipient, asset, chain, and action restrictions work.
- Every state-changing action is constructed, decoded, verified, and simulated.
- Approval is envelope-bound and single-use.
- Agent revocation and system pause work.
- MCP, CLI, and dashboard use the same authorization core.
- Lifecycle traces and audit records are complete.
- Unit, integration, E2E, property, adversarial, and concurrency tests pass.
- No unresolved critical or high security finding exists.
- Documentation matches implementation.
- Source-control history is clean and reviewable.
- Product owner signs off on the MVP review.

A visual demo without these guarantees is not the MVP.

---

## 38. Initial Workstream Ownership Recommendation

The lead orchestrator may adjust parallelism, but the following domains should have clear ownership:

1. **Architecture and governance**
   - Domain model, ADRs, boundaries, integration contracts

2. **Policy and budget ledger**
   - Policy engine, accounting, reservation concurrency, idempotency

3. **Transaction pipeline**
   - Construction, decoding, simulation, envelope, reconciliation

4. **Wallet adapter and local chain**
   - Anvil, fake token, signer boundary, adapter SDK

5. **Approval and controls**
   - Approval state, hashing, pause, revocation, recovery

6. **Agent interfaces**
   - MCP, CLI, SDK shape, Agent Skill

7. **Dashboard**
   - Owner UX, approvals, policies, operations, audit

8. **Security, observability, and test systems**
   - Threat model, telemetry, property tests, adversarial suite, CI

Agents must not independently redefine shared schemas. Shared-contract changes require orchestrator coordination.

---

## 39. Product Backlog Taxonomy

All future features should be registered under one category:

- `CORE`
- `POLICY`
- `BUDGET`
- `TRANSACTION`
- `SIMULATION`
- `APPROVAL`
- `WALLET_ADAPTER`
- `MCP`
- `CLI`
- `SDK`
- `SKILL`
- `DASHBOARD`
- `IDENTITY`
- `OBSERVABILITY`
- `SECURITY`
- `TESTING`
- `OPERATIONS`
- `DOCUMENTATION`
- `RESEARCH`

Each feature record should include:

- Problem
- User
- Scope
- Dependencies
- Security impact
- Acceptance criteria
- Test requirements
- Phase
- Owner
- Status
- Evidence

---

## 40. Initial Architecture Decisions

These are baseline decisions and should be converted to formal ADRs during Phase 0.

### ADR candidate 001 — Crip is a control plane, not a wallet-specific clone

Core schemas and authorization must remain provider-neutral.

### ADR candidate 002 — Local fake-money MVP first

No mainnet or real-wallet integration before MVP completion.

### ADR candidate 003 — Atomic-unit accounting only

No floating-point monetary arithmetic.

### ADR candidate 004 — Database reservations plus stronger adapter enforcement

The ledger prevents orchestration races. On-chain or signer enforcement is added where supported.

### ADR candidate 005 — Canonical intent before transaction

The LLM does not provide raw calldata for standard operations.

### ADR candidate 006 — Approval binds to immutable envelope

Textual confirmation alone is insufficient.

### ADR candidate 007 — Autonomous mode preserves hard limits

No Beast/YOLO mode that removes budget and authority limits.

### ADR candidate 008 — Minimal agent surface

Expose a small capability-oriented MCP interface and progressive Agent Skill references.

### ADR candidate 009 — OpenTelemetry-compatible lifecycle evidence

Trace context must cross interface, core, adapter, and reconciliation boundaries.

### ADR candidate 010 — Enforcement grades are first-class

Provider capability and security claims must be explicit and machine-readable.

---

## 41. Open Questions Requiring Later Decisions

These questions do not block Phase 0 unless noted:

- Exact monorepo tooling
- Exact relational database and query layer
- Exact owner approval authentication for local MVP
- Whether reservations include a maximum network-fee budget in MVP
- Confirmation depth on local chain and later testnets
- Audit event hash-chain implementation
- Queue/worker technology
- Whether API and MCP server are separate processes
- Policy expression language versus typed policy object
- Formal verification scope for smart-contract modules
- License choice
- Hosted-service boundary
- Safe allowance versus ERC-7710 delegation for first testnet adapter
- How to attest adapter conformance
- How policy portability maps to provider-specific restrictions
- How token price and USD budgets will be safely introduced later

Each decision must be resolved through an ADR before dependent production code lands.

---

## 42. Legal, Safety, and Product Claims

Crip documentation and UI must not claim:

- Funds are risk-free
- Policies are impossible to bypass across every adapter
- A control-plane restriction is cryptographic when it is not
- A local test signer is production safe
- Simulations guarantee execution outcomes
- Threat scanning guarantees safety
- Open source means audited
- Users cannot lose funds
- Crip provides investment, tax, or legal advice

Risk communication must be accurate and adapter-specific.

---

## 43. Definition of Done for Any Feature

A feature is done only when:

- Acceptance criteria pass.
- Security implications are documented.
- Tests exist at appropriate levels.
- Failure and retry behavior are defined.
- Telemetry exists where operationally relevant.
- Documentation and schemas are updated.
- No dead path or alternate authorization path is introduced.
- Source control is clean.
- Verification evidence is recorded.
- The orchestrator updates project state and workstream status.
- Review confirms no conflict with this specification.

---

## 44. Reference Sources

The following public sources informed the baseline architecture:

- MetaMask Agent Wallet architecture and quickstart:
  - https://docs.metamask.io/agent-wallet/reference/architecture/
  - https://docs.metamask.io/agent-wallet/quickstart/
- MetaMask Agent Skills:
  - https://github.com/MetaMask/agent-skills
- MetaMask Smart Accounts Kit / delegation framework:
  - https://github.com/MetaMask/smart-accounts-kit
- Safe AI-agent spending limit and modules:
  - https://docs.safe.global/home/ai-agent-quickstarts/agent-with-spending-limit
  - https://docs.safe.global/advanced/smart-account-modules
- Turnkey delegated agent signing:
  - https://docs.turnkey.com/features/policies/delegated-access/agentic-wallets
- MCP tools and security guidance:
  - https://modelcontextprotocol.io/specification/
- Agent Skills specification:
  - https://agentskills.io/specification
- OpenTelemetry semantic conventions:
  - https://opentelemetry.io/docs/specs/semconv/
- Ethereum standards:
  - https://eips.ethereum.org/EIPS/eip-4337
  - https://eips.ethereum.org/EIPS/eip-7579
  - https://eips.ethereum.org/EIPS/eip-7710
  - https://eips.ethereum.org/EIPS/eip-7715

---

## 45. Closing Product Rule

Crip must make the following statement true in implementation, not merely in documentation:

> The agent can act quickly, but it cannot grant itself more power, hide what it is doing, spend the same budget twice, reuse an old approval, or bypass the user’s active authority boundary.

Until that statement is demonstrated through reproducible tests, Crip remains experimental.
