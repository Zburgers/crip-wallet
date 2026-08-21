# Roadmap

Owner: lead orchestrator.
Update rule: after phase planning, gate review, material scope change, or product-owner decision.
`docs/PRODUCT_SPEC.md` controls gate semantics.

| Phase | Outcome | Entry | Exit evidence | Status |
| --- | --- | --- | --- | --- |
| 0 | Governance, reproducible local environment and repository safety | Verified baseline | Governing S0 controls | **PASS** |
| 1 | Canonical contracts, atomic ledger and S1 authorization/control proof without signing | S0 | Unit + DB + concurrency + property + approval/revocation proof, protected current-head verification | **PASS / S1 ACCEPTED** |
| 2 | Construct/verify/simulate/sign/reconcile fake ERC-20 on Anvil | S1 | Chain vertical slice and reconciliation evidence | **OPEN - P2-01 READY; ADR-0015 ACCEPTED; P2-02 UNBLOCKED AFTER P2-01 REVIEW** |
| 3 | Integrated approval/revocation/pause/recovery across execution boundary | Stable Phase-2 adapter/pipeline | Replay/race/recovery E2E | BLOCKED |
| 4 | MCP, CLI, dashboard and Agent Skill | Stable core API | Interface parity and browser evidence | BLOCKED |
| 5 | Telemetry, adversarial hardening and MVP review | Integrated local product | S2, full matrix, no critical/high findings, owner sign-off | BLOCKED |
| 6+ | Testnet/provider adapters | Explicit post-MVP approval | S3 and external review | OUT OF MVP |

The local WS-005 S1 slice is complete because S1 explicitly requires approval replay and revocation/pause proof. Phase 3 still owns the later integrated pre-sign/broadcast/recovery behavior.

Phase 2 is restricted to the local fake-money boundary. Opening WS-004 does not authorize public RPC, testnet/mainnet, real funds, production custody or production identity.

The implementation-ready packet plan is `docs/plans/PHASE-2.md`. ADR-0015 is accepted and now governs the exact EIP-1559 envelope-v2, local signer, persist-before-send broadcast, and authenticated reconciliation boundary. P2-02 is therefore no longer blocked on architecture approval, but it must not begin until P2-01 is reviewed and its fixture/toolchain contract is stable.
