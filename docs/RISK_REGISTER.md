# Risk Register

Owner: lead orchestrator with named workstream owners. Update rule: after threat,
design, dependency, verification, scope, or status changes. `Open` risks require
mitigation evidence before their related gate passes.

| ID | Risk / category | Likelihood | Impact | Mitigation and detection | Owner | Phase | Status |
|---|---|---|---|---|---|---|---|
| R-001 | Real/public funds accidentally configured / safety | Medium | Critical | Local-only schema/startup tests; scan URLs/keys; visible warnings | WS-001 | 0 | Open |
| R-002 | Provider coupling creates alternate authority / architecture | Medium | High | Import boundaries and adapter conformance | WS-002 | 1 | Open |
| R-003 | Concurrent reservations overspend / integrity | High | Critical | Serializable transaction, constraints, concurrency/property proof | WS-003 | 1 | Locally mitigated; S1 open |
| R-004 | Retry duplicates reservation or execution / reliability | High | Critical | Request-bound idempotency, durable state, bounded retry, worker/serialization retry proofs | WS-003 | 1 | Locally mitigated; execution proof open |
| R-005 | Non-canonical envelope hash permits mismatch / integrity | Medium | Critical | JCS vectors, version/domain separation, immutable rows | WS-002 | 1 | Open |
| R-006 | Stale approval/control state signs / authorization | Medium | Critical | Envelope revisions, one-time approval, pre-sign fence | WS-005 | 3 | Open |
| R-007 | Enforcement grade coercion overclaims protection / claims | Medium | High | Strict enum and conformance/UI tests | WS-002 | 1 | Open |
| R-008 | Revocation falsely treated as chain cancellation / operations | Medium | High | Lifecycle-specific semantics and adversarial UX tests | WS-005 | 3 | Open |
| R-009 | Destructive migration loses financial state / data | Low | Critical | Forward-only review, checksum drift fail-closed recovery and transactional DDL rollback; backup/restore and correction drills remain | WS-003 | 1 | Open; recovery drill outstanding |
| R-010 | Native fees corrupt ERC-20 allocation / accounting | Medium | High | Separate assets, integer ceiling checks | WS-004 | 2 | Open |
| R-011 | Local approval represented as production identity / claims | Medium | High | Test-only labels, loopback/session/replay tests | WS-005 | 3 | Open |
| R-012 | Local signer key leaks to agent/UI/logs / secrets | Medium | Critical | Process isolation, ignored generated state, redaction tests | WS-004 | 2 | Open |
| R-013 | Audit event missing from state transition / evidence | Medium | High | Typed full-event verification, DB hash guard, same-transaction rollback, sequence, retry, and append-only tests | WS-003 | 1 | Locally mitigated; integrated audit open |
| R-014 | Telemetry leaks sensitive data / privacy | Medium | High | Attribute allowlist and redaction/adversarial tests | WS-007 | 5 | Open |
| R-015 | Stale worker acts after lease loss / concurrency | Medium | Critical | Fencing versions and deterministic lease tests | WS-005 | 3 | Open |
| R-016 | MCP/CLI/dashboard bypass core / authorization | Medium | Critical | One service, contract/parity tests | WS-006 | 4 | Open |
| R-017 | UI reports failure while funds may have moved / UX | Medium | High | Structured uncertainty and broadcast recovery journeys | WS-006 | 4 | Open |
| R-018 | No selected repository license / legal | High | High | Owner selects license; compatibility review | WS-001 | 0 | Open |
| R-019 | `main` lacks branch protection / source control | High | High | Require CI/review after workflow lands; verify GitHub settings | Lead | 0 | Open |
| R-020 | Dependabot security updates disabled / supply chain | Medium | Medium | Enable after manifest/lockfile land; dependency audit CI | Lead | 0 | Open |

Detection evidence is recorded in `docs/TEST_MATRIX.md` and workstream files;
mitigation text alone does not close a risk.
