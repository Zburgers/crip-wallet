# Workstreams

Workstreams are bounded ownership contracts, not status summaries. Owner: lead
orchestrator. Update rule: when scope, files, dependencies, contracts, status,
evidence, or integration order changes.

| Workstream                                                        | Phase | Status                                    | Dependency                      |
| ----------------------------------------------------------------- | ----- | ----------------------------------------- | ------------------------------- |
| [WS-001](WS-001-governance-toolchain.md) Governance and toolchain | 0     | LOCAL COMPLETE / REMOTE CONTROLS VERIFIED | Required review                 |
| [WS-002](WS-002-domain-contracts.md) Canonical domain contracts   | 1     | FROZEN LOCALLY / S1 OPEN                  | Phase-0 local validation        |
| [WS-003](WS-003-budget-ledger.md) Atomic budget ledger            | 1     | COMPLETE LOCALLY / S1 OPEN                | WS-002 contracts and migrations |
| WS-004 Transaction pipeline/local adapter                         | 2     | NOT OPENED                                | Gate S1                         |
| [WS-005](WS-005-approval-controls.md) Approval and controls       | 3     | WP-04 COMPLETE LOCALLY / S1 OPEN          | Stable envelope/adapter         |
| WS-006 Interfaces/dashboard                                       | 4     | NOT OPENED                                | Stable application API          |
| WS-007 Observability/adversarial review                           | 5     | NOT OPENED                                | Integrated vertical slice       |

Open later workstreams only after their shared contracts stabilize. Agent prompts
must include baseline SHA, governing sections, owned files, frozen interfaces,
invariants, tests, docs, commands, commit expectations, evidence, and escalation
conditions from `docs/LEAD_ORCHESTRATOR_PROMPT.md`.
