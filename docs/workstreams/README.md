# Workstreams

Workstreams are bounded ownership contracts, not status summaries. Owner: lead
orchestrator. Update rule: when scope, files, dependencies, contracts, status,
evidence, or integration order changes.

| Workstream | Phase | Status | Dependency |
|---|---|---|---|
| [WS-001](WS-001-governance-toolchain.md) Governance and toolchain | 0 | ACTIVE | Verified baseline |
| [WS-002](WS-002-domain-contracts.md) Canonical domain contracts | 1 | QUEUED | Phase-0 local validation |
| [WS-003](WS-003-budget-ledger.md) Atomic budget ledger | 1 | BLOCKED | WS-002 contracts and migrations |
| WS-004 Transaction pipeline/local adapter | 2 | NOT OPENED | Gate S1 |
| WS-005 Approval and controls | 3 | NOT OPENED | Stable envelope/adapter |
| WS-006 Interfaces/dashboard | 4 | NOT OPENED | Stable application API |
| WS-007 Observability/adversarial review | 5 | NOT OPENED | Integrated vertical slice |

Open later workstreams only after their shared contracts stabilize. Agent prompts
must include baseline SHA, governing sections, owned files, frozen interfaces,
invariants, tests, docs, commands, commit expectations, evidence, and escalation
conditions from `docs/LEAD_ORCHESTRATOR_PROMPT.md`.
