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
| Chain | mock token and local fixture; later build/decode/simulate/broadcast/reconcile | `npm run test:chain` |
| Adversarial | all threat fixtures and bypass attempts | `npm run test:adversarial` |
| E2E | owner/agent journeys through public interfaces | `npm run test:e2e` |
| Browser | dashboard UX, approvals, controls, accessibility | `npm run test:browser` |

Until a suite exists, its command must fail clearly or be absent from the full
gate; it may not report a false pass. `docs/TEST_MATRIX.md` is authoritative for
planned versus evidenced coverage.

## Phase-1 gate parameters

The commands are wired through `tooling/phase1-test-gate.mjs` and use the
canonical values in `tooling/phase1-test-parameters.mjs`:

- `npm run test:invariants`: fast-check lifecycle seed `2026081301`, malformed
  input seed `2026081302`, event-sequence seed `2026081303`, and `512` runs per
  property.
- `npm run test:concurrency`: `4` workers, `32` rounds, a
  `ready/start/release` barrier, and a `5000 ms` barrier timeout.
- `npm run test:db`: loopback PostgreSQL whose host, effective port, database,
  and user are loaded from `.local/runtime.env`.

Database and concurrency gates fail closed when their required test directories
are absent. This preserves a visible `BLOCKED` result until real migrations,
reservation, and race tests are added; empty suites cannot report a pass.

## Required environment

`npm run dev:up` starts digest-pinned PostgreSQL and Foundry/Anvil containers on
loopback. It creates `.local/runtime.env` mode `0600` as the authoritative,
checkout-bound effective configuration: Docker assigns collision-free host
ports, and `dev:up` persists those ports after health checks. DB and concurrency
tests load that same file; a missing, copied, stopped, or conflicting runtime
fails closed instead of falling back to a shared default or another checkout.
The Compose project and PostgreSQL volume are checkout-specific. Tests use only
chain 31337 and generated disposable state under `.local/`.

`CRIP_POSTGRES_PORT=<other-port> npm run test:concurrency` is expected to fail
before connecting when it disagrees with the persisted runtime, protecting the
suite's destructive `TRUNCATE ... CASCADE` setup.

## Phase-2 local fixture gate

The P2-01 fixture is deliberately narrower than the complete S2 transaction
pipeline. It proves the disposable fixed-supply token and the checkout-bound
Anvil boundary without claiming construction, signing, broadcast recovery, or
reconciliation.

- `npm run contracts:test`: pinned Forge/Anvil Docker image; 10 MockERC20 tests.
- `npm run fixture:phase2`: verifies loopback/31337 runtime identity, deploys
  only from a clean Anvil reset, verifies deployment receipt, bytecode hash,
  metadata and initial supply, and writes `.local/phase2-fixture.json` mode
  `0600` without private-key material.
- `npm run test:chain -- fixture.test.ts`: 9 Vitest tests covering positive
  fixture verification and transfer behavior, public-host/wrong-chain guards,
  checkout binding, malformed Anvil state, stale/code-hash mismatch, and
  reset/redeploy instance staleness and secret-free output.

The chain suite is fail-closed when the requested suite is missing. A transfer
mutates disposable Anvil state; rerun the lifecycle and fixture commands from a
fresh reset before rerunning the suite.

## Evidence promotion

Unit evidence cannot satisfy database, concurrency, chain, or E2E rows. A healthy
container is not proof of product behavior. Browser verification is required only
after the dashboard exists and must include the actual approval, revocation,
pause, denial, and uncertain-outcome workflows.

## Failure handling

Classify environment failure separately from product failure, retain original
output, and do not mark a gate passed. Skips require a reason, owner, and expiry
in the test matrix. Flaky security tests block their gate until determinized.
