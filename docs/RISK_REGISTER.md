# Risk Register

Owner: lead orchestrator.
Update rule: after threat, design, dependency, verification, scope, or status changes.
Open risks must remain visible until their related phase/gate evidence exists.

| ID | Risk | Impact | Current mitigation/status |
| --- | --- | --- | --- |
| R-001 | Real/public funds accidentally configured | Critical | Local-only validation and no-real-funds boundary; **mitigated for S0**, remains release-sensitive |
| R-002 | Provider coupling creates alternate authority | High | ADR-0001/0009 plus accepted ADR-0015 keep core provider-neutral; the local IDs-only DB-loaded signer is explicitly a reference-adapter mechanism, not a universal provider requirement; adapter conformance remains Phase 2+ |
| R-003 | Concurrent reservations overspend | Critical | Serializable ledger + deterministic concurrency/property proof; **mitigated for S1** |
| R-004 | Retry duplicates reservation/execution | Critical | Request-bound idempotency + local recovery proof; reservation side **mitigated for S1**, execution side Phase 2/3 |
| R-005 | Envelope mismatch | Critical | Canonical hash/binding/replacement invalidation; **mitigated for S1**; exact signed-field binding moves to envelope v2 in Phase 2 |
| R-006 | Stale approval/control state authorizes | Critical | WP-07/08/10 canonical auth + owner authentication + four-scope fences; **mitigated for S1**, immediate pre-sign integration Phase 3 |
| R-007 | Enforcement-grade coercion | High | Strict enum/order implemented; adapter claims remain Phase 2+ |
| R-008 | Revocation mistaken for chain cancellation | High | Local lifecycle semantics proven; chain semantics remain Phase 3 |
| R-009 | Destructive migration/data loss | Critical | Forward-only checksum-locked migrations and corrective migration practice; backup/restore drill later |
| R-010 | Native fees corrupt token budget | High | Separate-asset rule plus accepted ADR-0015 type-2 fee binding; Phase-2 implementation/proof pending |
| R-011 | Local approval represented as production identity | High | ADR-0008 local-test owner authentication implemented; production identity explicitly out of scope; **mitigated for local S1** |
| R-012 | Signer key leaks | Critical | ADR-0009/0015 require a separate local IDs-only signer boundary with no general-signing or secret output; implementation/redaction proof pending Phase 2 |
| R-013 | Audit omitted/tampered | High | Row-derived same-transaction audit guards; integrated trace/audit Phase 5 |
| R-014 | Telemetry leaks sensitive data | High | Phase 5 |
| R-015 | Stale worker acts after lease loss | Critical | Authenticated bounded DB-time recovery leases; **mitigated for local S1**, provider integration later |
| R-016 | Interface bypasses core | Critical | Interfaces not opened; Phase 4 |
| R-017 | UI reports failure while funds moved | High | Phase 3/4 structured uncertainty |
| R-018 | License incompatibility | High | MIT via ADR-0013; mitigated |
| R-019 | Sole-maintainer merge-governance limitation | High | Active ruleset requires `validate`, deletion/non-fast-forward protection; zero separate-account approval is explicitly documented and must not be misrepresented as independent human approval |
| R-020 | Dependency security-update drift | Medium | Dependabot + audit CI; mitigated/monitored |
| R-021 | Checkout tests collide/corrupt another checkout | Critical | Checkout-bound runtime + Docker-assigned loopback ports + shared loader; mitigated locally |
| R-022 | Envelope omits exact signed EVM fields | Critical | **Architecture mitigated:** ADR-0015 is accepted and requires additive envelope v2 (`2.0` + v2 hash domain) binding resolved nonce, type, priority/max fee, gas, calldata/value and `accessList: []` plus exact simulation block identity. Remains open until P2-02 schema/DB/mutation proof lands |
| R-023 | Constructor verifies its own calldata | Critical | Accepted design requires `viem` construction plus a separate strict 68-byte ERC-20 parser with no ABI decoder dependency and per-field mutation vectors; implementation proof pending P2-02 |
| R-024 | RPC response loss causes false failure and budget release | Critical | Accepted ADR-0015 requires expected transaction hash + broadcast-attempt persistence before send; transport/response loss is UNKNOWN/DISPUTED and retains funds; deterministic forward-then-drop proof pending P2-05/06 |
| R-025 | Receipt or chain evidence reconciles the wrong operation | Critical | Accepted boundary treats chain data as untrusted, requires full transaction/receipt/log operation-reservation-hash matching, and preserves ADR-0014 authenticated RECONCILER evidence before exactly-once ledger mutation; proof pending P2-05 |
| R-026 | Local-chain reset makes stale evidence appear current | High | Accepted design requires chain/genesis/fixture/deployment-code fingerprint verification plus canonical simulation block identity at simulation/sign/reconciliation boundaries; fixture and fault proof pending P2-01/03/05/06 |

Detection evidence lives in `docs/TEST_MATRIX.md` and the relevant workstream files.
