# Workstreams

Workstreams are bounded ownership contracts. Gate semantics come from `docs/PRODUCT_SPEC.md`.

| Workstream | Phase | Status | Dependency |
| --- | --- | --- | --- |
| WS-001 Governance/toolchain | 0 | COMPLETE / S0 PASS | — |
| WS-002 Canonical domain contracts | 1 | FROZEN LOCALLY | S0 |
| WS-003 Atomic budget ledger | 1 | COMPLETE LOCALLY | WS-002 |
| WS-005 Approval/controls — S1 slice | 1 prerequisite | COMPLETE LOCALLY | WS-002/003 |
| WS-004 Transaction pipeline/local adapter | 2 | NOT OPENED | Gate S1 |
| WS-005 Approval/controls — integrated execution slice | 3 | NOT OPENED | Stable WS-004 boundary |
| WS-006 Interfaces/dashboard | 4 | NOT OPENED | Stable application API |
| WS-007 Observability/adversarial review | 5 | NOT OPENED | Integrated local product |

WS-005 is intentionally split by evidence layer: its local authorization/control primitives were pulled forward to satisfy S1, while pre-sign, signed-unbroadcast and broadcast-unknown integration remains Phase 3 work.
