# Risk Register

Owner: lead orchestrator.
Update rule: after threat, design, dependency, verification, scope, or status changes.
Open risks must remain visible until their related phase/gate evidence exists.

| ID | Risk | Impact | Current mitigation/status |
| --- | --- | --- | --- |
| R-001 | Real/public funds accidentally configured | Critical | Local-only validation and no-real-funds boundary; **mitigated for S0**, remains release-sensitive |
| R-002 | Provider coupling creates alternate authority | High | Provider work not opened; adapter conformance remains Phase 2+ |
| R-003 | Concurrent reservations overspend | Critical | Serializable ledger + deterministic concurrency/property proof; **mitigated for S1** |
| R-004 | Retry duplicates reservation/execution | Critical | Request-bound idempotency + local recovery proof; reservation side **mitigated for S1**, execution side Phase 2/3 |
| R-005 | Envelope mismatch | Critical | Canonical hash/binding/replacement invalidation; **mitigated for S1** |
| R-006 | Stale approval/control state authorizes | Critical | WP-07/08/10 canonical auth + owner authentication + four-scope fences; **mitigated for S1**, pre-sign integration Phase 3 |
| R-007 | Enforcement-grade coercion | High | Strict enum/order implemented; adapter claims remain Phase 2+ |
| R-008 | Revocation mistaken for chain cancellation | High | Local lifecycle semantics proven; chain semantics remain Phase 3 |
| R-009 | Destructive migration/data loss | Critical | Forward-only checksum-locked migrations and corrective migration practice; backup/restore drill later |
| R-010 | Native fees corrupt token budget | High | Separate-asset rule; Phase 2 implementation pending |
| R-011 | Local approval represented as production identity | High | ADR-0008 local-test owner authentication implemented; production identity explicitly out of scope; **mitigated for local S1** |
| R-012 | Signer key leaks | Critical | No signer implementation yet; Phase 2 process-isolation/redaction work pending |
| R-013 | Audit omitted/tampered | High | Row-derived same-transaction audit guards; integrated trace/audit Phase 5 |
| R-014 | Telemetry leaks sensitive data | High | Phase 5 |
| R-015 | Stale worker acts after lease loss | Critical | Authenticated bounded DB-time recovery leases; **mitigated for local S1**, provider integration later |
| R-016 | Interface bypasses core | Critical | Interfaces not opened; Phase 4 |
| R-017 | UI reports failure while funds moved | High | Phase 3/4 structured uncertainty |
| R-018 | License incompatibility | High | MIT via ADR-0013; mitigated |
| R-019 | Sole-maintainer merge-governance limitation | High | Active ruleset requires `validate`, deletion/non-fast-forward protection; zero separate-account approval is explicitly documented and must not be misrepresented as independent human approval |
| R-020 | Dependency security-update drift | Medium | Dependabot + audit CI; mitigated/monitored |
| R-021 | Checkout tests collide/corrupt another checkout | Critical | Checkout-bound runtime + Docker-assigned loopback ports + shared loader; mitigated locally |
| R-022 | Envelope omits exact signed EVM fields | Critical | Envelope v1 lacks resolved nonce, transaction type, priority fee and complete simulation block identity; proposed ADR-0015 is a blocking prerequisite for P2-02 |
| R-023 | Constructor verifies its own calldata | Critical | Phase-2 plan requires viem construction plus a separate strict 68-byte ERC-20 parser with mutation vectors |
| R-024 | RPC response loss causes false failure and budget release | Critical | Persist expected hash/attempt before send; unknown outcomes retain/dispute funds; deterministic forward-then-drop tests in P2-06 |
| R-025 | Receipt or chain evidence reconciles the wrong operation | Critical | Full transaction/receipt/log matching plus operation/reservation/hash unique bindings and authenticated reconciler evidence planned for P2-05 |
| R-026 | Local-chain reset makes stale evidence appear current | High | Persist and verify chain/genesis/fixture/deployment-code fingerprint at simulation, sign and reconciliation boundaries |

Detection evidence lives in `docs/TEST_MATRIX.md` and the relevant workstream files.
