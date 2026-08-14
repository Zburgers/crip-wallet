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

| Gate                    | Current evidence                                                                                                                                                                                                 | Status       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| S0 repository safety    | Secret scanning, push protection, Dependabot security fixes, active main ruleset `20791659`, green remote CI/Gitleaks for PR #1, and MIT licensing are verified; required review acceptance remains              | OPEN         |
| S1 core invariant proof | WS-002/WS-003 local implementation and proof suites pass; independent approval/revocation/pause fencing acceptance, authenticated adapter/reconciler integration, integrated recovery, and review acceptance remain | BLOCKED      |
| S2 local E2E            | No vertical slice yet                                                                                                                                                                                            | BLOCKED      |
| S3 testnet readiness    | Out of MVP; requires stronger adapter/auth and review                                                                                                                                                            | NOT STARTED  |
| S4 real-value canary    | Prohibited without explicit owner approval                                                                                                                                                                       | OUT OF SCOPE |

## WP-03 authorization evidence

The local WP-03 slice adds persisted approval requests, append-only approval
decisions, canonical Keccak-verified and schema-validated envelope/policy/reservation
bindings, atomic envelope replacement invalidation, unique authorization evidence,
deferred operation/reservation consistency checks, expiry/rejection/revocation
fencing, and serializable one-time consumption. The focused database
and concurrency evidence is green, but Gate S1 remains `BLOCKED`: this packet
does not implement the ADR-0008 local owner session or test-key signature
artifact because the work instruction prohibits signing. Pause/revocation races,
authenticated owner-session controls, adapter/reconciler integration, recovery,
and independent security acceptance remain open.

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
