# Threat Model

Owner: security and verification workstream. Update rule: before accepting any
change that expands signing, autonomy, protocol/chain support, custody, public
surface, dependency trust, or recovery behavior.

## Security objective

An untrusted agent must never authorize more value or broader authority than the
active owner policy. Crip must also make every authorization and lifecycle result
traceable without exposing credentials.

## Assets

- Owner authority and agent credentials
- Budget availability, reservations, and finalized spend
- Active policy versions and pause/revocation state
- Execution-envelope and approval integrity
- Signer-local transaction bytes and nonce authority
- Transaction, receipt, reconciliation, audit, and trace evidence
- Database and migration integrity

## Trust boundaries

Agent/MCP/browser input, RPC responses, ABI/token metadata, adapter responses,
webhooks, external providers, and dependencies are untrusted. The MVP trusted
computing base is limited to validated schemas, deterministic policy, ledger
transactions, canonical envelope hashing, approval verification, local signer
fencing, database integrity, local-chain configuration, secrets boundary, and
transactional audit writing.

## Threat actors

Malicious, hallucinating, prompt-injected, or compromised agents; compromised
clients or owner sessions; malicious RPC/contract/ABI/adapter/dependency; replay
and race attackers; insiders with partial access; and accidental operator error.

## Required scenarios and controls

| ID | Scenario | Primary controls | Required test |
|---|---|---|---|
| T-001 | Total allocation overspend | Balanced ledger, serializable reserve | TM-001 |
| T-002 | Split or concurrent overspend | Per-account transaction fence, property invariant | TM-002 |
| T-003 | Duplicate intent or DB retry | Payload hash plus unique idempotency key | TM-003 |
| T-004 | Duplicate broadcast | Durable lifecycle, hash/nonce recovery | TM-004 |
| T-005 | Approval replay | Envelope hash, nonce, atomic one-time consumption | TM-005 |
| T-006 | Chain substitution | Canonical CAIP-2 binding, local-only config | TM-006 |
| T-007 | Recipient/amount/asset substitution | Independent decode and intent verification | TM-007 |
| T-008 | Calldata or extra-call substitution | Crip construction, strict selector and call count | TM-008 |
| T-009 | Gas ceiling bypass or fee spike | Integer max-cost check at envelope and pre-sign | TM-009 |
| T-010 | Stale/downgraded policy | Immutable version binding and pre-sign recheck | TM-010 |
| T-011 | Expired approval/intent | Bounded expiry and pre-sign recheck | TM-011 |
| T-012 | Revoked credential or pause bypass | Authoritative versioned control fences, serialized control/consumer locks, transactional stale-authority invalidation, and future immediate pre-sign recheck | TM-012 |
| T-013 | Unlimited approval/Permit/signature abuse | MVP action allowlist; no generic sign/call surface | TM-013 |
| T-014 | `delegatecall`, multicall, proxy hiding | Transfer-only builder/decoder; unknown denied | TM-014 |
| T-015 | Token decimals/metadata manipulation | Trusted configured identity and on-chain verification | TM-015 |
| T-016 | RPC disagreement or malicious simulation | Local chain identity, block binding, fail closed | TM-016 |
| T-017 | Simulation/execution divergence | Revalidation and envelope supersession | TM-017 |
| T-018 | Sign timeout or signed-unbroadcast ambiguity | Quarantine, disputed reservation, recovery fence | TM-018 |
| T-019 | Broadcast timeout before persistence | Search known hash/nonce before retry | TM-019 |
| T-020 | Revert/reorg/receipt confusion | Confirmation policy and trusted receipt decoding | TM-020 |
| T-021 | Reservation leak/expiry race | Leased recovery, balanced release transaction | TM-021 |
| T-022 | Malicious webhook | Authentication, replay protection, non-authoritative input | TM-022 |
| T-023 | Audit tampering or omission | Transactional append, constraints, hash chain | TM-023 |
| T-024 | Credential/secret disclosure | Process boundary, redaction, ignored local state | TM-024 |
| T-025 | SQL/command injection | Strict schemas and parameterized queries/no shell data | TM-025 |
| T-026 | Owner-session/CSRF abuse | Loopback, Strict cookie, CSRF and envelope signature | TM-026 |
| T-027 | Interface authorization bypass | One application authorization service | TM-027 |
| T-028 | Enforcement-grade overclaim | Strict enum and adapter conformance | TM-028 |
| T-029 | Migration/data-loss corruption | Forward-only migrations, restore/correction evidence | TM-029 |
| T-030 | Dependency/supply-chain compromise | Lock, audit, pin, minimal dependencies | TM-030 |

## Abuse paths

The highest-risk path combines concurrent idempotency races, stale policy, and a
signing timeout. The ledger must commit one reservation; the envelope must bind
that reservation and policy version; the versioned control fence must observe
revocation or pause under the shared lock order; the pre-sign fence must observe
the same current snapshot;
and ambiguous signed state must retain value rather than release it. No single
interface or worker may bypass these controls.

## Residual MVP limits

Control-plane rules can be bypassed if the local signer or its host is fully
compromised. Anvil keys are disposable and fake-value only. Simulation and audit
hash chains are evidence, not guarantees. Production custody and public-network
operation remain outside MVP and require Gate S3.
