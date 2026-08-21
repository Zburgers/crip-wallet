# Phase 2 — Local EVM Vertical Slice / Gate S2

**Goal:** prove one complete fake-ERC-20 execution journey on a clean local Anvil chain without weakening the S0/S1 security boundaries.

**Entry gate:** S1 PASS / ACCEPTED.

**Implementation branch:** `phase-2/ws-004-local-erc20`.

## Governing vertical slice

Phase 2 owns the following local execution path:

`construct → independently decode/verify → simulate → authorize → locally sign → broadcast → confirm → reconcile`

The transaction pipeline must begin from the existing canonical intent/policy/ledger model. It must not add an alternate raw-signing or alternate-authorization path.

## Scope

Phase 2 owns:

- one deterministic mock ERC-20 contract and local fixture/deployment path;
- provider-neutral transaction construction from canonical intents;
- independent transaction decoding and intent-to-transaction verification;
- state-changing simulation and revert handling;
- explicit native-fee estimation/ceilings separate from token-budget accounting;
- execution-envelope finalization using existing canonical hashing/binding rules;
- a restricted local-Anvil adapter and signer boundary;
- local transaction signing without exposing signer secrets to the agent/control-plane interface;
- local RPC broadcast, confirmation and receipt verification;
- deterministic reconciliation of reservation state from authoritative local-chain evidence;
- chain-level retry, ambiguity, stale-evidence and fault tests required for the Phase-2 proof.

## Non-goals

Phase 2 does **not** authorize:

- public RPC endpoints;
- testnet or mainnet;
- real cryptocurrency or stablecoins;
- production custody or production credentials;
- the product owner's existing wallet or MetaMask seed/private key;
- provider integrations other than the local Anvil reference adapter;
- arbitrary raw transaction signing;
- arbitrary `personal_sign` or EIP-712 signing;
- unlimited approvals, `setApprovalForAll`, `delegatecall`, bridge/swap/DeFi flows;
- Phase-4 MCP/CLI/dashboard product interfaces;
- claiming that the Phase-3 pre-sign/revocation/broadcast-unknown integration proof is complete.

## Required modules

The Phase-2 implementation should establish or complete these bounded modules:

- `contracts/mock-token/`
- `packages/transaction-pipeline/`
- `packages/simulation/`
- `packages/adapter-sdk/`
- `adapters/local-anvil/`
- chain/E2E/fault tests and fixtures

Existing package boundaries may be reused when they already satisfy the governing architecture; do not create duplicate abstractions merely to match a path name.

## Work packets

### P2-01 — Deterministic local asset and chain fixture

Deliver one mock ERC-20, deterministic deployment/fixture setup, disposable local accounts and reproducible clean-Anvil reset behavior.

Proof:
- correct chain ID `31337` / `0x7a69`;
- deterministic token/address fixture where practical;
- no public RPC binding;
- no real-wallet material;
- fixture reset cannot target a non-local chain.

### P2-02 — Construction and independent verification

Construct one ERC-20 transfer from the canonical intent, then decode/verify the resulting transaction independently of the construction path.

Verification must compare at minimum:
- chain;
- sender/wallet;
- target contract;
- function selector/action;
- recipient;
- token amount;
- calldata;
- value;
- nonce strategy;
- gas/fee constraints;
- policy/envelope identity where applicable.

Any mismatch or unsupported/opaque calldata must fail closed.

### P2-03 — Simulation and fee enforcement

Simulate every state-changing Phase-2 transaction before signing authorization.

Prove:
- successful transfer simulation;
- contract revert handling;
- insufficient token balance;
- insufficient native fee balance;
- fee-ceiling rejection;
- stale simulation invalidation/revalidation;
- token budget and native gas accounting remain distinct.

### P2-04 — Restricted local signer/adapter boundary

Implement the local Anvil reference adapter using the provider-neutral adapter contract.

Prove:
- signer secret remains inside the adapter boundary;
- agent-facing/control-plane results never expose private-key material;
- the adapter only signs an already-authorized immutable envelope;
- unsupported capability/enforcement claims fail closed;
- logging and errors redact sensitive signer material.

### P2-05 — Broadcast, confirmation and reconciliation

Broadcast only to the configured local Anvil endpoint, obtain authoritative receipt/chain evidence and reconcile the existing reservation exactly once.

Prove:
- confirmed success finalizes spend once;
- definitive pre-broadcast failure releases according to the governing lifecycle;
- receipt mismatch is rejected/disputed rather than treated as success;
- duplicate confirmation/reconciliation is idempotent;
- wrong-chain or wrong-transaction evidence cannot reconcile another operation.

### P2-06 — Fault, ambiguity and S2 evidence

Exercise the chain boundary under controlled faults.

At minimum cover:
- RPC unavailable before broadcast;
- request sent / response lost;
- duplicate broadcast attempt;
- transaction hash known but receipt temporarily unavailable;
- receipt status revert;
- receipt/calldata/recipient/amount discrepancy;
- stale nonce / replacement conflict where applicable;
- worker retry after uncertain outcome;
- local adapter crash/restart around broadcast;
- reconciliation exactly once.

Unknown execution outcome must retain protected funds in the governing held/disputed/pending state until authoritative evidence resolves it. Do not release budget merely because the caller did not receive a response.

## Gate S2 acceptance

S2 remains **NOT PASSED** until a fresh protected current-head run proves the complete local vertical slice and records reproducible evidence in `docs/TEST_MATRIX.md`.

Required evidence must include:

- all inherited S0/S1 checks remain green;
- clean Anvil setup and deterministic mock-token fixture;
- successful construct/independent-verify/simulate/authorize/sign/broadcast/confirm/reconcile journey;
- mismatch/revert/balance/gas/fee/stale-simulation failures fail closed;
- ambiguous broadcast/recovery behavior preserves financial safety;
- signer secrets do not cross the adapter boundary;
- complete correlated audit evidence for the local execution journey;
- no public RPC, testnet, mainnet, real-funds or production-custody capability introduced.

## Implementation rules

- Use the repository Shipyard execution skill for implementation work.
- Treat `docs/PRODUCT_SPEC.md` as governing authority.
- Preserve strict schemas, deterministic hashing, integer-only money and the balanced ledger invariant.
- Use forward-only migrations; do not rewrite applied financial migrations.
- Add red-first tests for each trust-boundary change.
- Keep commits focused and source control clean.
- If implementation requires a material trust-boundary or governing-contract change, document the contradiction and obtain product-owner approval rather than silently changing the model.
