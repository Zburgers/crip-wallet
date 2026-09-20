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
webhooks, external providers, and dependencies are untrusted. Component
credentials are provisioned out of band and private keys remain outside the
agent-facing path. The MVP trusted computing base is limited to validated
schemas, deterministic policy, ledger transactions, canonical envelope hashing,
approval verification, the restricted local signer/revalidation boundary,
database integrity, local-chain configuration, secrets boundary, authenticated
reconciliation, and transactional audit writing.

## Threat actors

Malicious, hallucinating, prompt-injected, or compromised agents; compromised
clients or owner sessions; malicious RPC/contract/ABI/adapter/dependency; replay
and race attackers; insiders with partial access; and accidental operator error.

## Required scenarios and controls

| ID    | Scenario                                     | Primary controls | Required test |
| ----- | -------------------------------------------- | ---------------- | ------------- |
| T-001 | Total allocation overspend                   | Balanced ledger, serializable reserve | TM-001 |
| T-002 | Split or concurrent overspend                | Per-account transaction fence, property invariant | TM-002 |
| T-003 | Duplicate intent or DB retry                 | Payload hash plus unique idempotency key | TM-003 |
| T-004 | Duplicate broadcast                          | Authenticated evidence, durable lifecycle, expected hash/nonce recovery | TM-004 |
| T-005 | Approval replay                              | Envelope hash, nonce, atomic one-time consumption | TM-005 |
| T-006 | Chain substitution                           | Canonical CAIP-2 binding, fixture identity, local-only config | TM-006 |
| T-007 | Recipient/amount/asset substitution          | Independent decode and intent verification | TM-007 |
| T-008 | Calldata or extra-call substitution          | Crip construction, strict selector/length/padding and single-call shape | TM-008 |
| T-009 | Gas ceiling bypass or fee spike              | Integer max-cost check at envelope and immediate pre-sign | TM-009 |
| T-010 | Stale/downgraded policy                      | Immutable version binding and pre-sign recheck | TM-010 |
| T-011 | Expired approval/intent                      | Bounded expiry and pre-sign recheck | TM-011 |
| T-012 | Revoked credential or pause bypass           | Authoritative versioned control fences, serialized control/consumer locks, transactional stale-authority invalidation, immediate pre-sign recheck | TM-012 |
| T-013 | Unlimited approval/Permit/signature abuse    | MVP action allowlist; no generic sign/call surface | TM-013 |
| T-014 | `delegatecall`, multicall, proxy hiding      | Transfer-only builder/decoder; unknown denied | TM-014 |
| T-015 | Token decimals/metadata manipulation         | Trusted configured identity and on-chain verification | TM-015 |
| T-016 | RPC disagreement or malicious simulation     | Local fixture identity, canonical block binding, fail closed | TM-016 |
| T-017 | Simulation/execution divergence              | Bounded freshness, changed-precondition re-simulation, envelope supersession | TM-017 |
| T-018 | Sign timeout or signed-unbroadcast ambiguity | IDs-only signer; expected hash; component-signed recovery claim; uncertain outcome stays held | TM-018 |
| T-019 | Broadcast timeout / response loss            | Persist expected transaction hash and broadcast attempt before send; recover by known hash/nonce; timeout never proves failure | TM-019 |
| T-020 | Revert/reorg/receipt confusion               | Canonical block check plus independent transaction/receipt/Transfer-log matching; receipt is untrusted evidence, not authority | TM-020 |
| T-021 | Reservation leak/expiry race                 | Versioned authenticated leases, balanced release transaction | TM-021 |
| T-022 | Malicious webhook                            | Authentication, replay protection, non-authoritative input | TM-022 |
| T-023 | Audit tampering or omission                  | Transactional append, constraints, hash chain | TM-023 |
| T-024 | Credential/secret disclosure                 | Process boundary, redaction, ignored local state | TM-024 |
| T-025 | SQL/command injection                        | Strict schemas and parameterized queries/no shell data | TM-025 |
| T-026 | Owner-session/CSRF abuse                     | Loopback, Strict cookie, CSRF and envelope signature | TM-026 |
| T-027 | Interface authorization bypass               | One application authorization service | TM-027 |
| T-028 | Enforcement-grade overclaim                  | Strict enum and adapter conformance | TM-028 |
| T-029 | Migration/data-loss corruption               | Forward-only migrations, restore/correction evidence | TM-029 |
| T-030 | Dependency/supply-chain compromise           | Lock, audit, pin, minimal dependencies | TM-030 |
| T-031 | Constructor self-verification                | `viem` encoder plus separate narrow manual canonical transfer parser with no ABI decoder dependency | TM-031 |
| T-032 | Signer chooses unbound transaction fields    | Accepted envelope v2 (`2.0` + distinct v2 hash domain) binds all unsigned type-2 fields including resolved nonce, priority/max fee, gas, calldata/value and `accessList: []`; local signer accepts IDs only | TM-032 |
| T-033 | Response-loss falsely releases reservation   | Persist expected hash/attempt before send; transport uncertainty remains pending/disputed and cannot authorize release | TM-033 |
| T-034 | Receipt or transaction evidence substitution | Full transaction/receipt/log + operation/reservation/hash binding; ADR-0014 authenticated RECONCILER evidence before ledger mutation | TM-034 |
| T-035 | Local-chain reset confusion                  | Chain/genesis/fixture/deployment-code fingerprint plus canonical simulation block identity at execution boundaries | TM-035 |
| T-036 | Control changes after signing but before send, or an alternate raw sender bypasses `STARTED` | Sole restricted send gateway; fence-first send gate; signed/no-attempt quarantine; retained disputed reservation; authenticated no-send recovery | TM-036 |
| T-037 | Post-send control change blocks recovery      | Immutable committed attempt/hash authority after `STARTED`; current fences cannot cancel or strand reconciliation | TM-037 |
| T-038 | Signer/control deadlock or stale lock winner  | One canonical fence-first lock order and deterministic two-winner concurrency barriers | TM-038 |
| T-039 | Stale recovery worker resolves with app-clock skew | SQL DB-time lease/version check at final mutation | TM-039 |

## Abuse paths

The highest-risk path combines concurrent idempotency races, stale policy, and a
signing or broadcast timeout. The ledger must commit one reservation; envelope
v2 must bind that reservation, policy version, simulation identity, and every
unsigned EIP-1559 field; the versioned control fence must observe revocation or
pause under the shared lock order; immediate pre-sign revalidation must observe
the same current authority; expected transaction hash and broadcast-attempt
identity must be durable before send; and ambiguous signed/broadcast state must
retain value rather than release it. No single interface or worker may bypass
these controls.

## Residual MVP limits

Control-plane rules can be bypassed if the local signer or its host is fully
compromised. Anvil keys are disposable and fake-value only. A single local RPC
can lie consistently; the local S2 proof does not establish Byzantine RPC
independence. Simulation and audit hash chains are evidence, not guarantees.
One included Anvil block is local test evidence, not production finality.
Production custody and public-network operation remain outside MVP and require
later explicit gates and review.

## Phase-2 trust-boundary review

The Phase-2 design and packet ownership are recorded in `docs/plans/PHASE-2.md`.
ADR-0015 is **ACCEPTED** and closes the architecture-level exact-signing gap:

- envelope v1 remains frozen for Phase-1 evidence; envelope v2 uses schema
  version `2.0` and a separate v2 hash-preimage version;
- every unsigned type-2 field is authorization-bound, including
  `accessList: []`;
- simulation freshness is based on canonicality, bounded age, and changed
  execution assumptions rather than mere head advancement;
- the IDs-only DB-loaded signer is a local-Anvil reference-adapter mechanism,
  not a requirement that all future adapters directly access PostgreSQL;
- expected transaction hash and attempt identity are persisted before send;
- RPC transaction/block/receipt/log material is untrusted evidence;
- ADR-0014 authenticated RECONCILER evidence remains the authority boundary
  before exactly-once financial reconciliation.

The owning Phase-2 packets provide executable local evidence; protected
implementation/provenance checks and external review `5126373971` accepted the
governing local boundary. S2 requirement evidence is PASS and Gate S2 is
**PASS / ACCEPTED**. Phase 3 is now IN PROGRESS; P3-01 passed MAX review and
exact-SHA CI/Secret Scan. P3-02 locally quarantines signed/no-attempt work,
continues exact ACCEPTED/UNKNOWN reconciliation after control, blocks REJECTED
no-send attempts from re-entering broadcast, and passes static, DB 145/145,
and concurrency 18/18; its exact-SHA review/CI and the
remaining Phase-3 evidence are still open.

P2-03 provides local executable evidence for the canonical-block, loopback-only,
RPC-disagreement, fee-ceiling, token/native separation, exact-field mutation,
and bounded-freshness controls. P2-05D and P2-06 add the signer, broadcast,
recovery, substitution and reconciliation evidence; public-network Byzantine
independence and Phase-3 integrated controls remain out of scope.

## P2-05D/P2-06 controls (implemented; S2 accepted for the local boundary)

ADR-0016 addresses autonomous-authority forgery, approval fabrication, cross-kind races, and invalidation drift by keeping one canonical authorization root with mutually exclusive owner-approval and autonomous-policy evidence. Only a persisted immutable `ALLOW_AUTONOMOUS` decision may authorize the latter, and the signer applies the same common hard-control revalidation. P2-05D implementation and local/protected evidence are recorded in the current TEST_MATRIX checkpoint.

ADR-0017 addresses raw-byte leakage and the signed-evidence/pre-send crash gap by composing signing and the accepted broadcaster inside the restricted local child. Serialized bytes remain volatile. Deterministic rematerialization is permitted only with durable signed evidence and no attempt, after full current revalidation and durable-hash equality. Any send-capable attempt prohibits re-signing and uses expected-hash recovery. P2-05D proves the clean path locally; P2-06 proves fault, ambiguity and substitution handling locally.

The implementation retains a narrow dependency on deterministic behavior of the locked transaction serializer/signature stack and a restricted child with loopback send capability. Golden signed vectors, dependency review, strict output scans, loopback/fixture checks and reuse of the accepted broadcaster are evidenced locally; the external S2 review accepts only this local boundary. Public-network Byzantine independence, production finality, and production telemetry remain unclaimed.

## Phase-3 integrated threat treatment

Phase 3 / WS-005 is IN PROGRESS. P3-01 and P3-02 passed their exact-SHA
reviews and protected checks. P3-03 candidate
`510763b3c9c217f9058b1c9d388ce02d84e6ae9e` adds fence-first `STARTED`
authority and canonical recovery for a mined transaction after process death;
its fresh MAX review passed 9/10 with no findings; protected CI `35498889238`
and Secret Scan `35498889228` pass. P3-00 identified the signed/no-attempt control race, signer/control
lock inversion, and post-send current-fence recovery conflict. Accepted
ADR-0018 and `docs/plans/PHASE-3.md` define the controls for T-036 through
T-039. P3-04 local gates now prove DB-time lease renewal/fencing, exact signed-
no-attempt recovery, and the tested authorization/operation and policy/recovery
lock order; the P3-04 database suite passes 155/155. Exact-SHA review and
protected CI/Secret Scan are pending. P3-05/06 still own the adversarial matrix
and clean-room closeout. The
Phase-3 threats remain open until all required packets pass; local packet
evidence is not full Phase-3 acceptance.
