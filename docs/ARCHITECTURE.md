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
                               loopback RPC gateway
                                  | shared lease
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
| Local Anvil adapter  | Isolate disposable local signer and serialize final chain freshness with mutations                                            | Serve production/public networks            |
| Local RPC gateway    | Allowlist local RPC and checkpoint each mutation under the shared lease                                                      | Expose Anvil directly or accept arbitrary RPC methods |
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

## Phase-3 integrated boundary

Phase 3 is in progress. Accepted ADR-0018 defines two linearization points
between the accepted S1 fences and accepted S2 execution path. P3-01's DB
transaction and selected R-033 chain-mutation lease passed MAX review and
exact-SHA CI/Secret Scan. P3-02 quarantines signed/no-attempt work, allows
exact ACCEPTED/UNKNOWN reconciliation after control, and blocks REJECTED
no-send attempts from re-entering broadcast; its exact-SHA review and protected
checks passed. P3-03 candidate
`510763b3c9c217f9058b1c9d388ce02d84e6ae9e` implements the fence-first
`STARTED` send commit, sole-gateway enforcement, and real local-chain status
and recovery. A mined transaction tied to a still-STARTED attempt enters the
same canonical verifier and authenticated reconciliation path as other
recoverable attempts. Fresh exact-SHA review passed 9/10 (confidence 0.90,
no findings); protected CI `35498889238` and Secret Scan `35498889228` pass.

The integrated design is:

1. bounded local signing and signed-evidence persistence occur atomically in one
   fence-first database transaction; the signer acquires the mutation lease
   before its final freshness RPC and holds it through commit; and
2. a second fence-first transaction revalidates the exact authority before its
   `STARTED` commit becomes the send-commit point.

Before `STARTED`, a control change wins and signed evidence is retained in
`DISPUTED` with no send. After `STARTED`, the immutable attempt/hash lineage,
authenticated chain evidence, and a DB-time recovery lease authorize continued
reconciliation even if current fences later change. Phase 3 reuses the existing
four fence versions, authorization ID, attempt identity, and recovery
`lease_version`; it does not add a parallel epoch or lifecycle model.

## Deployment topology

MVP is a single developer-machine topology. PostgreSQL uses the `local-only`
bridge and a loopback-published host port. Anvil has no host port and runs only
on the internal `anvil-private` network. The RPC gateway connects to Anvil on
that network and uses a dedicated `gateway-host` bridge for its dynamically
assigned loopback host port; PostgreSQL cannot reach the gateway over a shared
container network. Supported mutations and Anvil lifecycle restarts share the
checkout-scoped lease. Each checkout derives a distinct Compose project and
database volume identity from its canonical path. `.local/` holds generated
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

ADRs 0001–0018 define the accepted current architecture. ADR-0018 is the
accepted Phase-3 implementation authority.
`docs/decisions/README.md` is the index; accepted records are superseded rather
than edited.
