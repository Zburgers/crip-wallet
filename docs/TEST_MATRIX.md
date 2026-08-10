# MVP Test Matrix

Owner: security and verification workstream. Update rule: with every requirement,
threat, test, run, skip, failure, or gate change. Status values are `PLANNED`,
`PASS`, `FAIL`, `BLOCKED`, or `NOT APPLICABLE`. Only reproducible evidence may
set `PASS`.

## Product and release requirements

| ID | Requirement | Layer / planned location | Status | Last evidence | Gap owner |
|---|---|---|---|---|---|
| PR-001 | Clean clone installs and baseline checks | CI + `tests/repository/` | PLANNED | None | WS-001 |
| PR-002 | Anvil 31337 and fake assets only | config + chain + adversarial | PLANNED | None | WS-001/004 |
| PR-003 | One owner/agent/wallet/policy/chain/token fixture | DB + E2E | PLANNED | None | WS-002 |
| PR-004 | Read-only, review, autonomous modes | unit + E2E | PLANNED | None | WS-002/005 |
| PR-005 | Total and per-transaction budget under concurrency | DB + concurrency + property | PLANNED | None | WS-003 |
| PR-006 | Chain/asset/recipient/action restrictions | policy + E2E | PLANNED | None | WS-002 |
| PR-007 | Atomic reservation before authorization | DB + transition | PLANNED | None | WS-003 |
| PR-008 | Retry/idempotency cannot duplicate spend | DB + concurrency + E2E | PLANNED | None | WS-003 |
| PR-009 | Canonical intent constructs transaction | unit + chain | PLANNED | None | WS-002/004 |
| PR-010 | Independent decode and verification | unit + chain + adversarial | PLANNED | None | WS-004 |
| PR-011 | Every state-changing operation simulated | chain + E2E | PLANNED | None | WS-004 |
| PR-012 | Immutable envelope after reservation | unit + DB | PLANNED | None | WS-002/003 |
| PR-013 | Approval envelope-bound and one-time | DB + adversarial + E2E | PLANNED | None | WS-005 |
| PR-014 | Owner key outside agent process | architecture + process/E2E | PLANNED | None | WS-004 |
| PR-015 | Immediate revocation and pause before signing | lifecycle + race + E2E | PLANNED | None | WS-005 |
| PR-016 | Native maximum network-fee ceiling | unit + pre-sign chain | PLANNED | None | WS-004 |
| PR-017 | MCP, CLI, dashboard share core | contract + E2E + browser | PLANNED | None | WS-006 |
| PR-018 | Minimal interfaces expose no raw signing | schema + adversarial | PLANNED | None | WS-006 |
| PR-019 | OpenTelemetry lifecycle correlation | integration + E2E | PLANNED | None | WS-007 |
| PR-020 | Append-only correlated audit history | DB + E2E | PLANNED | None | WS-003/007 |
| PR-021 | Adapter manifest and conformance | contract + adapter | PLANNED | None | WS-004 |
| PR-022 | Invalid lifecycle transitions rejected | unit + property | PLANNED | None | WS-002 |
| PR-023 | Failures/retries reconcile safely | DB + chain + fault | PLANNED | None | WS-004/005 |
| PR-024 | Documentation matches behavior | doc checks + review | PLANNED | None | Lead |
| PR-025 | No unresolved critical/high security findings | audit + review | BLOCKED | No implementation | WS-007 |
| PR-026 | Product-owner MVP sign-off | review record | BLOCKED | MVP not built | Owner |

## Threat and adversarial requirements

| ID | Threat coverage | Layer / planned location | Status | Last evidence | Gap owner |
|---|---|---|---|---|---|
| TM-001 | Total overspend | `tests/invariants/ledger.spec.ts` | PLANNED | None | WS-003 |
| TM-002 | Split/concurrent overspend | `tests/concurrency/reservations.spec.ts` | PLANNED | None | WS-003 |
| TM-003 | Duplicate/idempotency conflict | `tests/integration/idempotency.spec.ts` | PLANNED | None | WS-003 |
| TM-004 | Duplicate broadcast | `tests/fault/broadcast-recovery.spec.ts` | PLANNED | None | WS-004 |
| TM-005 | Approval replay | `tests/adversarial/approval-replay.spec.ts` | PLANNED | None | WS-005 |
| TM-006 | Chain substitution/public RPC | `tests/adversarial/chain-substitution.spec.ts` | PLANNED | None | WS-001/004 |
| TM-007 | Recipient/amount/asset substitution | `tests/adversarial/transfer-substitution.spec.ts` | PLANNED | None | WS-004 |
| TM-008 | Calldata/extra-call substitution | `tests/adversarial/calldata.spec.ts` | PLANNED | None | WS-004 |
| TM-009 | Fee ceiling bypass/spike | `tests/adversarial/network-fees.spec.ts` | PLANNED | None | WS-004 |
| TM-010 | Stale or downgraded policy | `tests/adversarial/stale-policy.spec.ts` | PLANNED | None | WS-002/005 |
| TM-011 | Expired approval/intent | `tests/adversarial/expiry.spec.ts` | PLANNED | None | WS-005 |
| TM-012 | Revocation/pause race | `tests/concurrency/control-fence.spec.ts` | PLANNED | None | WS-005 |
| TM-013 | Permit/unlimited/signature abuse | `tests/adversarial/signature-surface.spec.ts` | PLANNED | None | WS-004/006 |
| TM-014 | Delegatecall/multicall/proxy | `tests/adversarial/hidden-authority.spec.ts` | PLANNED | None | WS-004 |
| TM-015 | Decimal/metadata manipulation | `tests/adversarial/token-metadata.spec.ts` | PLANNED | None | WS-004 |
| TM-016 | RPC disagreement/malicious simulation | `tests/adversarial/rpc.spec.ts` | PLANNED | None | WS-004 |
| TM-017 | Re-simulation divergence | `tests/integration/envelope-revision.spec.ts` | PLANNED | None | WS-004/005 |
| TM-018 | Signed-unbroadcast ambiguity | `tests/fault/signing-boundary.spec.ts` | PLANNED | None | WS-004/005 |
| TM-019 | Broadcast persistence timeout | `tests/fault/broadcast-recovery.spec.ts` | PLANNED | None | WS-004/005 |
| TM-020 | Revert/reorg/receipt confusion | `tests/chain/confirmation.spec.ts` | PLANNED | None | WS-004 |
| TM-021 | Reservation leak/expiry race | `tests/concurrency/reservation-expiry.spec.ts` | PLANNED | None | WS-003/005 |
| TM-022 | Malicious/replayed webhook | `tests/adversarial/webhook.spec.ts` | PLANNED | None | WS-005 |
| TM-023 | Audit tampering/omission | `tests/integration/audit.spec.ts` | PLANNED | None | WS-003/007 |
| TM-024 | Secret output/log exposure | `tests/adversarial/redaction.spec.ts` | PLANNED | None | WS-001/007 |
| TM-025 | SQL/command injection | `tests/adversarial/injection.spec.ts` | PLANNED | None | WS-003/006 |
| TM-026 | Owner session/CSRF | `tests/browser/owner-security.spec.ts` | PLANNED | None | WS-005/006 |
| TM-027 | Interface bypass | `tests/e2e/interface-parity.spec.ts` | PLANNED | None | WS-006 |
| TM-028 | Enforcement overclaim | `tests/adapter-conformance/grades.spec.ts` | PLANNED | None | WS-002/004 |
| TM-029 | Migration/data loss | `tests/integration/migrations.spec.ts` | PLANNED | None | WS-003 |
| TM-030 | Dependency/supply chain | CI audit and action-pin checks | PLANNED | None | WS-001/007 |

## Phase-0 evidence

| ID | Check | Status | Evidence |
|---|---|---|---|
| P0-001 | Baseline SHA and clean-room inventory recorded | PASS | `3a044ee788297bf006c633ce97d61b30a6e6cf40`; audit 2026-08-10 |
| P0-002 | Canonical governing paths, no duplicates | PASS | Commit `5a9d80c`; byte identity checks exit 0 |
| P0-003 | Current-tree and history secret pattern scan | PASS | No pattern hits; gitleaks unavailable at baseline |
| P0-004 | Fresh npm install/static/test gate | PASS | 2026-08-10: `npm ci`; `npm run check`; 13/13 Node tests, static/docs/repo checks exit 0 |
| P0-005 | PostgreSQL/Anvil clean local startup | PASS | 2026-08-10: PostgreSQL 17.10; Anvil `0x7a69`; deterministic fixture; loopback-only; per-checkout project/volume; precreated mode `0600` state |
| P0-006 | CI and secret-scan workflow | PLANNED | No workflow at baseline |
| P0-007 | Protected main branch | FAIL | GitHub API: branch not protected on 2026-08-10 |
| P0-008 | License decision | BLOCKED | ADR-0013 requires owner decision |
