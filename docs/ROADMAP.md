# Roadmap

Owner: lead orchestrator.
Update rule: after phase planning, gate review, material scope change, or product-owner decision.
`docs/PRODUCT_SPEC.md` controls gate semantics.

| Phase | Outcome | Entry | Exit evidence | Status |
| --- | --- | --- | --- | --- |
| 0 | Governance, reproducible local environment and repository safety | Verified baseline | Governing S0 controls | **PASS** |
| 1 | Canonical contracts, atomic ledger and S1 authorization/control proof without signing | S0 | Unit + DB + concurrency + property + approval/revocation proof, protected current-head verification | **PASS / S1 ACCEPTED** |
| 2 | Construct/verify/simulate/sign/reconcile fake ERC-20 on Anvil | S1 | Chain vertical slice, reconciliation evidence and external S2 review | **COMPLETE / S2 ACCEPTED** |
| 3 | Integrated approval/revocation/pause/recovery across execution boundary | Stable accepted Phase-2 adapter/pipeline | P3-01–P3-06; replay/race/recovery E2E; independent review; protected clean-room gate | **IN PROGRESS / P3-01–P3-04 CLEARED; P3-05 LOCAL MATRIX PASS; P3-06 PENDING** |
| 4 | MCP, CLI, dashboard and Agent Skill | Stable core API | Interface parity and browser evidence | BLOCKED |
| 5 | Telemetry, adversarial hardening and MVP review | Integrated local product | S2, full matrix, no critical/high findings, owner sign-off | BLOCKED |
| 6+ | Testnet/provider adapters | Explicit post-MVP approval | S3 and external review | OUT OF MVP |

The local WS-005 S1 slice is complete because S1 explicitly requires approval replay and revocation/pause proof. Phase 3 still owns the later integrated pre-sign/broadcast/recovery behavior.

Phase 2 is restricted to the accepted local fake-money boundary. S2 acceptance does not authorize public RPC, testnet/mainnet, real funds, production custody or production identity.

The accepted Phase-2 boundary remains governed by `docs/plans/PHASE-2.md` and
ADR-0015. The implementation-ready Phase-3 packet plan is
`docs/plans/PHASE-3.md`, with concise orchestration instructions in
`docs/plans/PHASE-3-EXECUTION-HANDOFF.md`. Accepted ADR-0018 governs the
implementation. P3-01 implements the selected R-033 resolution with a
checkout-scoped chain-mutation lease: supported Anvil writers share a lock with
the signer, which samples freshness only after acquiring it and holds it
through signed-evidence commit. The RPC gateway is loopback-published, Anvil
has no host port, and PostgreSQL is on a separate bridge. P3-01 passed MAX
review and exact-SHA CI/Secret Scan. P3-02 uses migrations `0027`–`0030` and
passed fresh MAX review at 0.92 plus exact-SHA CI/Secret Scan on
`b95695c720fd68dd1085e371267a35113a05c816` (runs `35493551667` and
`35493551719`). P3-03 candidate
`510763b3c9c217f9058b1c9d388ce02d84e6ae9e` adds the `STARTED` send-commit
guard and canonical recovery for a mined transaction after process death. Its
fresh exact-SHA GPT-5.6 Luna MAX review passed 9/10 (confidence 0.90, no
findings); local check, DB 150/150, and Anvil E2E 1/1 pass. Protected exact-SHA
CI `35498889238` and Secret Scan `35498889228` pass. P3-04 local gates pass
(`npm run check`: 21 repository + 363 package tests; DB: 162/162;
`npm run test:phase3`: 254/254). Follow-up MAX review passed after remediation
of control/authorization lock ordering and stale sign-only artifacts; exact-SHA
CI `35787705165` and Secret Scan `35787705289` pass. P3-05 local matrix passes
(DB 163, Phase-3 255, concurrency 18, invariants 7, chain 10, E2E 1, fault
186, adversarial 213); the test-only candidate's exact-head CI/Secret Scan and
F18 remain pending.
F18 and final acceptance remain for P3-06. It adds
DB-time lease renewal/fencing, exact controlled signed-no-attempt recovery,
and lock-order race coverage for control, broadcast, recovery, authorized
envelope replacement, approval replay, autonomous authorization, signer, and
broadcaster paths. Exact-SHA MAX review and protected CI/Secret Scan are
pending; P3-05 and P3-06, full acceptance, S3 readiness, and any wider
network/custody boundary are not claimed.
