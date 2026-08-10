# Testing Strategy

Owner: security and verification workstream. Update rule: change with public
behavior, invariant, threat, tooling, suite command, or release gate.

## Principles

- Test public behavior and durable state, not implementation trivia.
- Security-critical code follows red-fail, minimal implementation, pass,
  negative/concurrency expansion, refactor.
- No timing sleeps when barriers, transactions, or fake clocks can coordinate.
- Critical database tests use real PostgreSQL; chain tests use clean Anvil.
- Coverage percentage supplements, never replaces, the test matrix.
- Every run records command, commit, environment, exact counts, and artifacts.

## Suites

| Layer | Scope | Default command |
|---|---|---|
| Static | formatting, lint, types, repo policy | `npm run check:static` |
| Unit | schemas, policy, arithmetic, lifecycle, hashes | `npm run test:unit` |
| Database | migrations, reservation, idempotency, audit | `npm run test:db` |
| Concurrency | simultaneous reservations/approval/control races | `npm run test:concurrency` |
| Property | generated transition and accounting sequences | `npm run test:invariants` |
| Chain | mock token, build/decode/simulate/broadcast/reconcile | `npm run test:chain` |
| Adversarial | all threat fixtures and bypass attempts | `npm run test:adversarial` |
| E2E | owner/agent journeys through public interfaces | `npm run test:e2e` |
| Browser | dashboard UX, approvals, controls, accessibility | `npm run test:browser` |

Until a suite exists, its command must fail clearly or be absent from the full
gate; it may not report a false pass. `docs/TEST_MATRIX.md` is authoritative for
planned versus evidenced coverage.

## Required environment

`npm run dev:up` starts digest-pinned PostgreSQL and Foundry/Anvil containers on
loopback. Tests generate disposable state under `.local/` and use only chain
31337. Clean-room runs begin with a fresh Compose volume and record image digests.

## Evidence promotion

Unit evidence cannot satisfy database, concurrency, chain, or E2E rows. A healthy
container is not proof of product behavior. Browser verification is required only
after the dashboard exists and must include the actual approval, revocation,
pause, denial, and uncertain-outcome workflows.

## Failure handling

Classify environment failure separately from product failure, retain original
output, and do not mark a gate passed. Skips require a reason, owner, and expiry
in the test matrix. Flaky security tests block their gate until determinized.
