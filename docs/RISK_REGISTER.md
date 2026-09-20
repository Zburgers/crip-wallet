# Risk Register

Owner: lead orchestrator.
Update rule: after threat, design, dependency, verification, scope, or status changes.
Open risks must remain visible until their related phase/gate evidence exists.

| ID | Risk | Impact | Current mitigation/status |
| --- | --- | --- | --- |
| R-001 | Real/public funds accidentally configured | Critical | Local-only validation and no-real-funds boundary; **mitigated for S0**, remains release-sensitive |
| R-002 | Provider coupling creates alternate authority | High | ADR-0001/0009 plus accepted ADR-0015 keep core provider-neutral; the local IDs-only DB-loaded signer is explicitly a reference-adapter mechanism, not a universal provider requirement; adapter conformance remains Phase 2+ |
| R-003 | Concurrent reservations overspend | Critical | Serializable ledger + deterministic concurrency/property proof; **mitigated for S1** |
| R-004 | Retry duplicates reservation/execution | Critical | Request-bound idempotency plus P2-05/P2-06 local proof; **mitigated for the Phase-2 local boundary**. P3-01/03/04 plan unconditional signed/attempt uniqueness and one-effect retry/takeover proof |
| R-005 | Envelope mismatch | Critical | Canonical hash/binding/replacement invalidation and exact envelope-v2 signed-field proof; **mitigated / accepted for the Phase-2 local boundary**; later integrated controls remain Phase 3 |
| R-006 | Stale approval/control state authorizes | Critical | WP-07/08/10 canonical auth + owner authentication + four-scope fences; **mitigated for S1**. Phase-3 pre-sign/send integration is OPEN until P3-01/02/03 evidence |
| R-007 | Enforcement-grade coercion | High | Strict enum/order implemented; adapter claims remain Phase 2+ |
| R-008 | Revocation mistaken for chain cancellation | High | ADR-0005 semantics proven locally; Phase 3 plans signed/no-attempt quarantine and treats `STARTED` as irrevocable send commit; implementation evidence OPEN |
| R-009 | Destructive migration/data loss | Critical | Forward-only checksum-locked migrations and corrective migration practice; backup/restore drill later |
| R-010 | Native fees corrupt token budget | High | Separate-asset rule plus P2-03/P2-06 checked type-2 max-cost/native-balance and signer-boundary proof; **mitigated / accepted for the Phase-2 local boundary** |
| R-011 | Local approval represented as production identity | High | ADR-0008 local-test owner authentication implemented; production identity explicitly out of scope; **mitigated for local S1** |
| R-012 | Signer key leaks | Critical | Mode-0600 generated state, isolated IDs-only signer, quiet logs and P2-06 adversarial leakage checks; **mitigated for the Phase-2 local boundary** |
| R-013 | Audit omitted/tampered | High | Row-derived same-transaction guards plus P2-05D durable trace and P2-06 adversarial evidence; integrated telemetry remains Phase 5 |
| R-014 | Telemetry leaks sensitive data | High | Phase 5 |
| R-015 | Stale worker acts after lease loss | Critical | Authenticated bounded recovery leases; **mitigated for local S1**. P3-04 must enforce DB time/version at final integrated economic mutation |
| R-016 | Interface bypasses core | Critical | Interfaces not opened; Phase 4 |
| R-017 | UI reports failure while funds moved | High | Phase 3/4 structured uncertainty |
| R-018 | License incompatibility | High | MIT via ADR-0013; mitigated |
| R-019 | Sole-maintainer merge-governance limitation | High | Active ruleset requires `validate`, deletion/non-fast-forward protection; zero separate-account approval is explicitly documented and must not be misrepresented as independent human approval |
| R-020 | Dependency security-update drift | Medium | Dependabot + audit CI; mitigated/monitored |
| R-021 | Checkout tests collide/corrupt another checkout | Critical | Checkout-bound runtime + Docker-assigned loopback ports + shared loader; mitigated locally |
| R-022 | Envelope omits exact signed EVM fields | Critical | ADR-0015 plus P2-02/P2-03/P2-04/P2-06 exact executable-field and signer proof; **mitigated / accepted for the Phase-2 local boundary**, not production-final |
| R-023 | Constructor verifies its own calldata | Critical | `viem` construction plus separate strict 68-byte ERC-20 parser and per-field mutation vectors; **mitigated / accepted for the Phase-2 local boundary**, not a general transaction decoder |
| R-024 | RPC response loss causes false failure and budget release | Critical | P2-06 fault/crash matrix proves durable hash/attempt persistence, UNKNOWN retention, forward-then-drop recovery and no release/re-sign; **mitigated for the Phase-2 local boundary** |
| R-025 | Receipt or chain evidence reconciles the wrong operation | Critical | P2-06 substitution/adversarial matrix proves full transaction/receipt/log/fixture/operation binding and authenticated exactly-once reconciliation; **mitigated for the Phase-2 local boundary** |
| R-026 | Local-chain reset makes stale evidence appear current | High | P2-01 fixture identity plus P2-03 simulation and P2-06 substitution evidence; **mitigated for the Phase-2 local boundary** |
| R-027 | `ALLOW_AUTONOMOUS` cannot create canonical authorization without fabricated approval | Critical | **MITIGATED / ACCEPTED FOR THE PHASE-2 LOCAL BOUNDARY:** ADR-0016 canonical authorization, persisted immutable decision/hash/fence binding, shared invalidation, race/forgery tests, clean production-writer E2E and completed P2-06 adversarial evidence; no production-control claim |
| R-028 | Signer-local bytes are discarded before the accepted broadcaster can send them | Critical | **MITIGATED / ACCEPTED FOR THE PHASE-2 LOCAL BOUNDARY:** ADR-0017 same-child signer/broadcaster composition, volatile raw bytes, durable signed evidence before STARTED/send, exact frozen vector, clean E2E and completed P2-06 fault evidence; no production-finality claim |
| R-029 | Serializer/signature dependency change invalidates deterministic rematerialization | High | **OPEN / proposed mitigation:** lock exact viem/crypto versions, freeze signed-byte/hash vectors, and require explicit dependency/security review before upgrade |
| R-030 | Pause/revoke after signed evidence or an alternate raw sender still reaches broadcast | Critical | **PARTIALLY MITIGATED LOCALLY / OPEN:** P3-02 migrations `0027`–`0030` quarantine signed/no-attempt work and block invalidated REJECTED reuse/release; P3-03 adds fence-first `STARTED` authority and sole-gateway enforcement. Candidate `510763b3c9c217f9058b1c9d388ce02d84e6ae9e` passed fresh exact-SHA review, CI, and Secret Scan. P3-05/06 own remaining adversarial and closeout evidence |
| R-031 | Post-send fence change strands or falsely releases economic effect | Critical | **PARTIALLY MITIGATED LOCALLY / OPEN:** P3-03 recovery verifies exact canonical evidence for ACCEPTED/UNKNOWN/CONFLICT and mined STARTED attempts after control, with one economic effect; invalidated REJECTED attempts remain blocked by `0029`/`0030`. P3-04 owns DB-time lease fencing and concurrency/takeover proof; P3-05/06 own remaining adversarial and closeout evidence |
| R-032 | Signer/control lock inversion deadlocks or selects stale authority | High | P3-01 canonical fence-first order, bounded DB-time checks, and deterministic two-winner PostgreSQL proof pass locally; integrated packet remains open |
| R-033 | Chain facts change after preflight while signing waits for DB fence locks | High | **MITIGATED FOR THE SUPPORTED LOCAL RUNTIME:** the loopback RPC gateway serializes supported Anvil mutations and lifecycle actions with the signer's lease; signing acquires the lease before its final freshness RPC and holds it through evidence commit. Candidate `404837db138ad1bd5c3aceaff6bae67652d5ed01` passed MAX review and exact-SHA CI/Secret Scan. Host Docker privileges remain inside the local trust boundary. |

Detection evidence lives in `docs/TEST_MATRIX.md` and the relevant workstream files.
