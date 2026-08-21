# Security Engineering

Owner: security and verification workstream. Update rule: change with threats,
trust boundaries, security controls, findings, release gates, or dependencies.

## Primary invariant

For every request, retry, race, policy change, and failure sequence, an agent
must never authorize more value or broader authority than active user policy.

## Mandatory boundaries

- Agent, prompts, tool arguments, browser input, RPC, ABI/metadata, adapters,
  webhooks, and third-party data are untrusted.
- Intent validation, policy, ledger, envelope hashing, approval verification,
  local adapter fence, database integrity, secrets boundary, and audit writer
  form the MVP trusted computing base.
- LLM output is never authorization.
- The owner key is never available to agent-facing processes or frontend code.
- Unknown schema, policy, calldata, signature, simulation, fee, or lifecycle
  state fails closed.

## Local-only controls

- Only CAIP-2 `eip155:31337` and loopback RPC hosts are allowed.
- Anvil and owner test material is generated into ignored `.local/` state.
- No seed phrase, production key, public network, unrestricted sign method, raw
  calldata, unlimited approval, `personal_sign`, or typed-data method exists.
- Startup prints a test-only warning and refuses unsafe environment values.
- Compose uses a normal bridge because an internal network prevents the required
  loopback host access on supported Docker setups. This permits container egress;
  digest pinning, the fake-only service set, loopback publication, public-network
  refusal, and a per-checkout Compose identity are the MVP compensating controls.

## Review checklist

Every change is checked for injection, authentication, access control, CSRF/XSS,
unsafe deserialization, secrets/log exposure, dependency and action pinning,
misconfiguration, insufficient audit evidence, race/retry behavior, state
transition validity, alternate authorization paths, and misleading enforcement
claims. Database queries are parameterized and transactions use one client.

## Security gates

| Gate | Current evidence | Status |
| --- | --- | --- |
| S0 repository safety | Secret scanning/push protection, locked dependencies, CODEOWNERS, active main ruleset `20791659`, vulnerability reporting, MIT licensing, and no-real-wallet/local-runtime controls were accepted in Phase 0/PR #1 | **PASS** |
| S1 core invariant proof | Protected Phase-1 evidence proves strict schemas/hashing, atomic ledger/idempotency, approval replay protection, authenticated local-owner approval, four-scope pause/revocation fences, authenticated recovery leases, DB/concurrency/property invariants, and current-head CI/Secret Scan | **PASS / ACCEPTED** |
| S2 local E2E | Phase 2 / WS-004 is open. ADR-0015 is accepted and defines exact EIP-1559 envelope/signing/evidence boundaries, but the complete local construct/verify/simulate/sign/broadcast/confirm/reconcile journey and fault proof are not yet accepted | **OPEN / NOT PASSED** |
| S3 testnet readiness | Out of MVP; requires stronger adapter/auth and review | NOT STARTED |
| S4 real-value canary | Prohibited without explicit owner approval | OUT OF SCOPE |

S0/S1 acceptance does not substitute for S2. No current document may represent
planning, a fake local fixture, or a partial Phase-2 packet as a completed chain
execution proof.

## WP-03 authorization evidence

The local WP-03 slice added persisted approval requests, append-only approval
decisions, canonical Keccak-verified and schema-validated envelope/policy/reservation
bindings, atomic envelope replacement invalidation, unique authorization evidence,
deferred operation/reservation consistency checks, expiry/rejection/revocation
fencing, and serializable one-time consumption. At the WP-03 checkpoint Gate S1
was still blocked because ADR-0008 local-owner authentication and later
pause/revocation/recovery work had not yet landed. Those later Phase-1 packets
subsequently closed that gate; this paragraph is historical packet evidence, not
the current gate state.

## Dependency and supply-chain policy

Lockfiles are committed; high/critical dependency findings block integration.
GitHub actions are commit-pinned and container images digest-pinned where
practical. New dependencies require purpose, maintenance, license, transitive
weight, and security review. Provider SDKs stay in adapters.

## Incident posture

Pause blocks new state-changing authorization. Revocation blocks new agent
authorization/signatures after durable success. Neither claims to cancel an
already-broadcast transaction. Ambiguous outcomes remain held/disputed and are
recovered by hash/nonce evidence.

## WP-04 control-fence proof

The local control plane stores authoritative system, owner, agent, and policy
state in monotonic `control_fences`. Approval, decision, and authorization-
evidence rows persist the complete fence snapshot. Control changes and
authorization consumers share the `SYSTEM -> OWNER -> AGENT -> POLICY` lock
order; committed pause/revocation invalidates stale authority and releases
eligible held reservations in the same transaction. Resume increments the
system fence and cannot resurrect old evidence. Deterministic local proof is in
`tests/concurrency/control-fence.test.ts`. At the WP-04 checkpoint provider/
signing and chain reconciliation remained outside that packet; later Phase-1
work closed S1, while actual local signing/chain integration remains Phase 2/3
work.

## WP-05 authenticated execution boundary and recovery

Phase 1 provisions adapter and reconciler Ed25519 public keys out of band in
`trusted_component_credentials`. An execution-boundary or recovery action must
carry a signature over a canonical, domain-separated action payload. The service
looks up the credential, checks its active status and role, verifies the
signature, and only then writes the action. `actorType` and `actorId` are
descriptive audit projections, never authority.

Broadcast evidence snapshots the credential ID, component ID, role, signature,
and signed-payload hash. Verification snapshots the same fields for the
reconciler. Recovery uses a PostgreSQL lease version and append-only attempt ID;
expired or stale workers fail closed, duplicate attempts return the original
result, and simultaneous recoverers serialize on the lease row. CONFIRMED can
finalize only matching immutable evidence. FAILED releases only authoritative
pre-broadcast failure. AMBIGUOUS and CONFLICT remain DISPUTED and keep funds
reserved. The Phase-1 proof used controlled local fakes and did not claim a chain
receipt or real execution.

## Phase-2 exact EVM execution boundary

Accepted ADR-0015 extends, rather than replaces, the Phase-1 security model:

- envelope v1 remains frozen for Phase-1 evidence;
- envelope v2 uses `schemaVersion: "2.0"` plus a distinct v2 hash-preimage version;
- every unsigned EIP-1559 field is bound before authorization, including resolved
  nonce, priority/max fee, gas limit, calldata/value, and `accessList: []`;
- simulation binds canonical block number/hash and becomes stale only under the
  accepted canonicality/freshness/precondition rules, not merely because a new
  head exists;
- the local-Anvil signer is an IDs-only DB-loaded reference-adapter mechanism,
  not a universal requirement that future provider adapters access PostgreSQL;
- the expected transaction hash and broadcast-attempt identity are persisted
  before send; transport/response loss never proves non-execution;
- RPC transactions, blocks, receipts, and logs are untrusted evidence inputs;
  ADR-0014 authenticated reconciler evidence remains required before the
  exactly-once ledger recovery path can mutate financial state;
- one included Anvil block is local S2 evidence only and is not a production
  finality claim.

Public RPC, testnet/mainnet, real assets, production custody, real-wallet
material, arbitrary signing, and provider integrations remain prohibited by the
current Phase-2 boundary.
