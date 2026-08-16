# Roadmap

Owner: lead orchestrator.
Update rule: after phase planning, gate review, material scope change, or product-owner decision.
`docs/PRODUCT_SPEC.md` controls gate semantics.

| Phase | Outcome | Entry | Exit evidence | Status |
| --- | --- | --- | --- | --- |
| 0 | Governance, reproducible local environment and repository safety | Verified baseline | Governing S0 controls | **PASS** |
| 1 | Canonical contracts, atomic ledger and S1 authorization/control proof without signing | S0 | Unit + DB + concurrency + property + approval/revocation proof, protected current-head verification | **LOCAL PASS / REMOTE CLOSEOUT PENDING** |
| 2 | Construct/verify/simulate/sign/reconcile fake ERC-20 on Anvil | S1 | Chain vertical slice and reconciliation evidence | **BLOCKED UNTIL S1 CLOSEOUT** |
| 3 | Integrated approval/revocation/pause/recovery across execution boundary | Stable Phase-2 adapter/pipeline | Replay/race/recovery E2E | BLOCKED |
| 4 | MCP, CLI, dashboard and Agent Skill | Stable core API | Interface parity and browser evidence | BLOCKED |
| 5 | Telemetry, adversarial hardening and MVP review | Integrated local product | S2, full matrix, no critical/high findings, owner sign-off | BLOCKED |
| 6+ | Testnet/provider adapters | Explicit post-MVP approval | S3 and external review | OUT OF MVP |

The local WS-005 S1 slice is already implemented because S1 explicitly requires approval replay and revocation/pause proof. Phase 3 still owns the later integrated pre-sign/broadcast/recovery behavior.
