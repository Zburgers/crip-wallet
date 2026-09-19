# Roadmap

Owner: lead orchestrator.
Update rule: after phase planning, gate review, material scope change, or product-owner decision.
`docs/PRODUCT_SPEC.md` controls gate semantics.

| Phase | Outcome | Entry | Exit evidence | Status |
| --- | --- | --- | --- | --- |
| 0 | Governance, reproducible local environment and repository safety | Verified baseline | Governing S0 controls | **PASS** |
| 1 | Canonical contracts, atomic ledger and S1 authorization/control proof without signing | S0 | Unit + DB + concurrency + property + approval/revocation proof, protected current-head verification | **PASS / S1 ACCEPTED** |
| 2 | Construct/verify/simulate/sign/reconcile fake ERC-20 on Anvil | S1 | Chain vertical slice, reconciliation evidence and external S2 review | **COMPLETE / S2 ACCEPTED** |
| 3 | Integrated approval/revocation/pause/recovery across execution boundary | Stable accepted Phase-2 adapter/pipeline | P3-01–P3-06; replay/race/recovery E2E; independent review; protected clean-room gate | **IN PROGRESS / P3-01 BLOCKED by R-033** |
| 4 | MCP, CLI, dashboard and Agent Skill | Stable core API | Interface parity and browser evidence | BLOCKED |
| 5 | Telemetry, adversarial hardening and MVP review | Integrated local product | S2, full matrix, no critical/high findings, owner sign-off | BLOCKED |
| 6+ | Testnet/provider adapters | Explicit post-MVP approval | S3 and external review | OUT OF MVP |

The local WS-005 S1 slice is complete because S1 explicitly requires approval replay and revocation/pause proof. Phase 3 still owns the later integrated pre-sign/broadcast/recovery behavior.

Phase 2 is restricted to the accepted local fake-money boundary. S2 acceptance does not authorize public RPC, testnet/mainnet, real funds, production custody or production identity.

The accepted Phase-2 boundary remains governed by `docs/plans/PHASE-2.md` and
ADR-0015. The implementation-ready Phase-3 packet plan is
`docs/plans/PHASE-3.md`, with concise orchestration instructions in
`docs/plans/PHASE-3-EXECUTION-HANDOFF.md`. Accepted ADR-0018 governs the
implementation. P3-01 revalidation is blocked by R-033: the current acceptance
requires detecting Anvil state changes during a DB lock wait while the accepted
ADR forbids RPC under those locks. P3-02 through P3-06, full acceptance, S3
readiness, and any wider network/custody boundary are not claimed.
