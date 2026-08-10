# ADR-0008: Local owner approval

## Status

Accepted — 2026-08-10

## Context

The MVP needs meaningful single-use owner approval without representing local
authentication as production identity.

## Decision

Use a loopback-only owner session protected by an HttpOnly, SameSite=Strict,
short-lived random session cookie and an owner test key generated into ignored
local state at bootstrap. An approval decision signs the envelope hash, policy
version, approval ID, expiry, and one-time nonce. The server consumes it exactly
once in the same database transaction that transitions authorization state.

No owner secret enters frontend JavaScript, agent interfaces, command history,
logs, repository files, or traces. The dashboard labels this mechanism
“LOCAL TEST ONLY — NOT PRODUCTION IDENTITY.”

## Alternatives considered

- Existing MetaMask approval: prohibited for MVP.
- Password-only local login: rejected because approval would not have a separate
  envelope-bound signature artifact.

## Consequences

- Local state deletion invalidates sessions and test approvals.
- Production owner identity remains a Gate S3 design requirement.

## Verification

- CSRF, session expiry, approval replay, changed-envelope, revocation, and
  concurrent consumption tests.

## Related

- Product spec sections 22, 27, and 28.
- Risk R-011; workstream WS-005.
