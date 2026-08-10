# Architecture

Owner: lead orchestrator. Update rule: change with any component boundary,
shared contract, trust boundary, deployment topology, or accepted ADR.

## System boundary

```text
untrusted agent / owner browser
        |
        v
API / MCP / CLI adapters -- authenticate and validate, never authorize
        |
        v
application authorization service
  intent -> policy -> ledger -> candidate -> verify -> simulate
        |                                  |
        |                                  v
        |                         immutable envelope
        v                                  |
PostgreSQL state + audit          approval / autonomous fence
                                           |
                                           v
                                 local Anvil adapter process
                                           |
                                           v
                              Anvil 31337 + mock ERC-20

Cross-cutting: OpenTelemetry, structured redacted logs, pause/revocation fences
```

## Components

| Component | Responsibility | Must not do |
|---|---|---|
| Interface adapters | Authenticate, validate public schemas, rate-limit, map errors | Decide policy or expose raw signing |
| Intent service | Canonicalize typed, idempotent provider-neutral intent | Trust hints as asset identity |
| Policy engine | Deterministic immutable-policy evaluation | Call LLMs or silently coerce unknown values |
| Budget ledger | Atomic reservations and balanced reconciliation | Use floating point or infer timeout failure |
| Transaction pipeline | Construct, decode, verify, simulate, finalize candidates | Accept raw calldata for MVP transfers |
| Approval/controls | Envelope-bound one-time approval, pause, revocation fence | Claim post-broadcast cancellation |
| Adapter SDK | Normalize capabilities, signing authorization, broadcast, receipts | Define core policy or overstate enforcement |
| Local Anvil adapter | Isolate disposable local signer and local RPC | Serve production/public networks |
| Audit/telemetry | Correlate durable events and operational evidence | Become authorization input or log secrets |
| Recovery worker | Idempotently resume leased lifecycle work | Recreate authorization on retry |

## Data flow and ordering

The only state-changing path is the sequence in ADR-0003. Construction produces
an execution candidate. The ledger transaction reserves value only after final
policy evaluation. The candidate becomes an immutable hashable envelope only
after reservation and policy-decision identifiers exist. Approval or autonomous
authorization binds to that exact revision. Policy/control/fee/nonce/expiry and
approval are rechecked immediately before signing.

## Deployment topology

MVP is a single developer-machine topology: loopback application processes,
loopback-published PostgreSQL, and loopback-published Anvil containers on one
private Compose network. `.local/` holds generated disposable state and is never
versioned. No public RPC, cloud service, testnet, or mainnet exists in scope.

## Shared contracts

Intent, policy, decisions, enforcement grades, lifecycle, envelope, adapter
manifest, audit event, telemetry names, errors, database IDs, MCP schemas, and
CLI JSON are shared. Changes require affected-workstream review, schema tests,
compatibility notes, and an ADR when security-relevant.

## Decision map

ADRs 0001–0012 define the current architecture. `docs/decisions/README.md` is the
index; accepted records are superseded rather than edited.
