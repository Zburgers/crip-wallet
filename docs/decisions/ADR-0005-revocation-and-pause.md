# ADR-0005: Revocation and pause semantics

## Status

Accepted — 2026-08-10

## Context

“Immediate revocation” cannot mean cancellation of an immutable, already
broadcast blockchain transaction. It must define a durable authorization cut-off
for every lifecycle point.

## Decision

A revocation succeeds only after durable persistence. Every authorization and
signing path rechecks agent, wallet, and system control state immediately before
signing. After success, the agent receives no new authorization or signature.

Pre-sign operations stop and release eligible reservations atomically.
Signed-but-unbroadcast bytes are quarantined and never broadcast; their
reservation remains disputed until non-execution is proven. Broadcast operations
continue monitoring and reconciliation because Crip cannot guarantee chain
cancellation. Confirmed operations reconcile normally.

Pause uses the same pre-sign barrier but is reversible. Revocation is a credential
and authority termination; re-enabling requires new owner action and credential,
not reversal of the audit record.

## Alternatives considered

- Claim cancellation after broadcast: rejected as technically false.
- Release signed-operation reservations immediately: rejected because delayed
  broadcast could overspend.

## Consequences

- Control state and sign authorization must share a transactionally coherent
  check or equivalent fencing token.
- The UI must distinguish blocked future authority from chain cancellation.

## Phase-1 implementation profile

The local authorization proof implements the fencing token as the monotonic
`control_fences.fence_version` plus state for the `SYSTEM`, `OWNER`, `AGENT`,
and `POLICY` scopes. Approval requests, decisions, and authorization evidence
persist all four snapshots. Authorization consumers and control mutations take
locks in the shared `SYSTEM -> OWNER -> AGENT -> POLICY` order before locking
approval, operation, reservation, and budget-account rows.

A committed control change appends a control audit event and transactionally
invalidates affected pending or authorized rows. System pause produces
`REVALIDATION_REQUIRED`; owner, agent, or policy revocation produces `REVOKED`.
Eligible held reservations are released while preserving the budget invariant.
Resume advances the system fence and does not resurrect old approvals. The
Phase-1 implementation stops at this database fence and intentionally has no
signing or broadcast consumer.

## Verification

- Adversarial tests at every lifecycle point, including races at the pre-sign
  fence and approval consumption.
- Recovery tests for signed, broadcast-unknown, pending, and confirmed states.

## Related

- Product spec sections 17.4, 19.4, 24.2, and 25.1.
- Risks R-006, R-008, and R-015; workstream WS-005.
