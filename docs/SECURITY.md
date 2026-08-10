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

## Review checklist

Every change is checked for injection, authentication, access control, CSRF/XSS,
unsafe deserialization, secrets/log exposure, dependency and action pinning,
misconfiguration, insufficient audit evidence, race/retry behavior, state
transition validity, alternate authorization paths, and misleading enforcement
claims. Database queries are parameterized and transactions use one client.

## Security gates

| Gate | Current evidence | Status |
|---|---|---|
| S0 repository safety | GitHub secret scanning and push protection enabled; branch protection absent; CI/lockfile pending in this branch | OPEN |
| S1 core invariant proof | No implementation or proof suite at verified baseline | BLOCKED |
| S2 local E2E | No vertical slice yet | BLOCKED |
| S3 testnet readiness | Out of MVP; requires stronger adapter/auth and review | NOT STARTED |
| S4 real-value canary | Prohibited without explicit owner approval | OUT OF SCOPE |

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
