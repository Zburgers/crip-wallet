# Roadmap

Owner: lead orchestrator. Update rule: after phase planning, gate review, material
scope change, or product-owner decision.

| Phase | Outcome                                                                     | Entry gate                        | Exit evidence                                                            | Status                      |
| ----- | --------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ | --------------------------- |
| 0     | Governance, reproducible local environment, CI and decisions                | Verified clean baseline           | Fresh install/check, local services, governance consistency, S0 controls | READY FOR EXTERNAL CLOSEOUT |
| 1     | Canonical contracts, deterministic policy and atomic ledger without signing | Phase 0 internal consistency      | Unit, DB, concurrency, property and idempotency proof                    | LOCAL COMPLETE / S1 OPEN    |
| 2     | Construct/verify/simulate/sign fake transfer on Anvil                       | S1 ledger proof                   | Chain vertical slice and reconciliation evidence                         | BLOCKED                     |
| 3     | Envelope approval, revocation, pause and recovery                           | Stable envelope/adapter contracts | Replay, race, lifecycle and recovery E2E                                 | BLOCKED                     |
| 4     | MCP, CLI, dashboard and Agent Skill                                         | Core authorization APIs stable    | Cross-interface parity and browser UX evidence                           | BLOCKED                     |
| 5     | Telemetry, adversarial hardening and MVP review                             | Integrated local product          | S1/S2, full matrix, no critical/high findings, owner sign-off            | BLOCKED                     |
| 6+    | Testnet and provider adapters                                               | Explicit post-MVP approval        | S3 requirements and external review                                      | OUT OF MVP                  |

No interface polish may bypass or outrun the ledger, envelope, approval, and
recovery proofs. `docs/plans/MVP_MASTER_PLAN.md` contains task-level integration
order and evidence.
