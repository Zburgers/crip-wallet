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

Cross-cutting: OpenTelemetry, structured redacted logs, pause/revocation fences,
authenticated local component credentials, and durable recovery leases
```

## Components

| Component            | Responsibility                                                                                                              | Must not do                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Interface adapters   | Authenticate, validate public schemas, rate-limit, map errors                                                               | Decide policy or expose raw signing         |
| Intent service       | Validate configured lifetime, canonicalize typed provider-neutral intent, and derive its versioned idempotency payload hash | Trust hints as asset identity               |
| Policy engine        | Deterministic immutable-policy evaluation                                                                                   | Call LLMs or silently coerce unknown values |
| Budget ledger        | Atomic reservations and balanced reconciliation                                                                             | Use floating point or infer timeout failure |
| Transaction pipeline | Construct, decode, verify, simulate, finalize candidates                                                                    | Accept raw calldata for MVP transfers       |
| Approval/controls    | Envelope-bound one-time approval, versioned pause/revocation fence, stale-authority invalidation                            | Claim post-broadcast cancellation           |
| Adapter SDK          | Normalize capabilities, signing authorization, broadcast, receipts                                                          | Define core policy or overstate enforcement |
| Local Anvil adapter  | Isolate disposable local signer and local RPC                                                                               | Serve production/public networks            |
| Audit/telemetry      | Correlate durable events and operational evidence                                                                           | Become authorization input or log secrets   |
| Recovery worker      | Idempotently resume leased lifecycle work                                                                                   | Recreate authorization on retry             |

## Data flow and ordering

The only state-changing path is the sequence in ADR-0003. Construction produces
an execution candidate. The ledger transaction reserves value only after final
policy evaluation. The candidate becomes an immutable hashable envelope only
after reservation and policy-decision identifiers exist. Approval or autonomous
authorization binds to that exact revision. Policy/control/fee/nonce/expiry and
approval are rechecked immediately before signing. The Phase-1 control proof
persists authoritative `control_fences` rows for system, owner, agent, and
policy scopes. Approval requests, decisions, and authorization evidence carry
all four fence snapshots. Consumers and control mutations serialize through the
same `SYSTEM -> OWNER -> AGENT -> POLICY` lock order, and a committed control
change invalidates stale pending/authorized work and releases eligible held
reservations transactionally. `authorization_invalidations` records why an
authorized evidence row can no longer be used. Resume advances the system
fence; it never restores the old snapshot.
Fence versions are PostgreSQL `bigint` values bounded at
`Number.MAX_SAFE_INTEGER` before they enter the JavaScript/audit contract, so
the local comparison path cannot lose version precision. WP-05 adds a separate
local execution-evidence boundary: adapter and reconciler actions must verify
an active Ed25519 credential and signed canonical payload; descriptive audit
actor labels are not authority. Evidence snapshots retain the credential and
signature hash. Recovery leases and attempt IDs are durable and fenced; unknown
outcomes remain disputed until authenticated reconciliation.

## Deployment topology

MVP is a single developer-machine topology: loopback application processes,
loopback-published PostgreSQL, and loopback-published Anvil containers on one
private Compose network. Each checkout derives a distinct Compose project and
database volume identity from its canonical path; host-port conflicts fail
instead of sharing another checkout's services. `.local/` holds generated
disposable state and is never versioned. No public RPC, cloud service, testnet,
or mainnet exists in scope.

## Shared contracts

Intent, policy, decisions, enforcement grades, lifecycle, envelope, adapter
manifest, audit event, telemetry names, errors, database IDs, MCP schemas, and
CLI JSON are shared. Intent lifetime configuration is expressed in positive
whole seconds. Idempotency records use the `@crip/schemas` versioned canonical
payload hash; this is distinct from the later envelope Keccak hash and does not
authorize, sign, or broadcast anything. Changes require affected-workstream
review, schema tests, compatibility notes, and an ADR when security-relevant.

## Decision map

ADRs 0001–0014 define the current architecture. `docs/decisions/README.md` is the
index; accepted records are superseded rather than edited.
