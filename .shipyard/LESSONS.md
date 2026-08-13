# Shipyard Lessons Learned

## [2026-08-13] Phase 1: Canonical Core and Ledger

### What Went Well
- Red-first PostgreSQL tests plus real serializable transactions exposed the important retry, migration, audit, and evidence boundaries before delivery.

### Surprises / Discoveries
- A syntactically valid receipt reference and an `adapter` actor label are not independent execution evidence; the reconciler and chain boundary must remain explicit.
- Database-side audit hashing must bind the canonical payload to the inserted columns, and legacy rows must fail closed when a new hash contract is introduced.

### Pitfalls to Avoid
- Do not treat same-process retry tests or manually injected `40001` errors as complete worker/recovery evidence; include response-loss and real PostgreSQL contention cases.
- Do not declare documentation reconciled until stale counts, gate statuses, and workstream indexes are searched after the final implementation changes.

### Process Improvements
- Run the exact Phase-1 gates, final database inspection, dependency audit, docs checks, and repository checks immediately before staging; record the resulting exact SHA and external blockers separately.

---
