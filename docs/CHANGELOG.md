# Changelog

Owner: lead orchestrator.
Update rule: record user/operator-visible, schema, security, policy, compatibility, dependency, or governance-authority changes in the same integration change.

## Unreleased

### Phase 2

- Opened Phase 2 / WS-004 from current `main` for the local fake-ERC-20 vertical slice: construct, independently verify, simulate, authorize, locally sign, broadcast, confirm and reconcile.
- Added `docs/plans/PHASE-2.md` and `docs/workstreams/WS-004-transaction-pipeline.md` with explicit local-only boundaries, packet order, S2 evidence requirements and chain-level ambiguity/fault coverage.
- Preserved the prohibition on public RPC, testnet/mainnet, real funds, production custody and production identity.
- Replaced the Phase-2 bootstrap outline with an implementation-ready architecture and packet plan covering exact interfaces, envelope/data migration impact, independent verification, simulation freshness, signer isolation, persist-before-send broadcast recovery, evidence-bound reconciliation, deterministic faults and S2 reproduction.
- Proposed ADR-0015 to add an exact EIP-1559 envelope-v2 boundary. P2-01 is ready; P2-02 remains blocked until product-owner acceptance because envelope v1 cannot bind every signed transaction field.

### Dependencies

- Merged `typescript-eslint` 8.67.0 and `@types/node` 26.2.0 after protected CI and Secret Scan passed on their update PRs.
- Kept TypeScript pinned at 6.0.3. Dependabot PR #2 for TypeScript 7.0.2 is intentionally ignored for the TypeScript 7 major line because `typescript-eslint@8.67.0` declares TypeScript `<6.1.0`; the attempted update fails closed during `npm ci` with `ERESOLVE`.

### Security

- WP-07 closes the alternate authorization path. Protected reservation states require canonical authorization evidence and the database rejects manufactured authorization/broadcast/finalization state.
- WP-08 implements ADR-0008 local-owner approval authentication with signed evidence bound to approval ID, approver/key identity, envelope hash, policy/version, expiry and nonce; authenticated approval is consumed once and owner private material remains outside agent-facing code and the database.
- Forward corrective migration `0021_wp08_owner_approval_auth_fix.sql` restores the missing persisted `authenticated_at` projection in owner-approval consumption while preserving checksum-locked migration 0020.
- WP-09 hardens recovery claims: lease duration is authenticated and bounded, lease validity/expiry uses PostgreSQL time, and caller-supplied time cannot steal a live lease.
- WP-10 closes the reservation-to-envelope revocation/pause gap and atomically releases eligible held reservations before an envelope exists.
- WP-11 places DB, deterministic concurrency and invariant/property suites inside the protected `validate` workflow so a core financial/authorization regression can no longer merge behind a static-only green check.

### Governance / planning

- Reconciled the gate model with the governing Product Spec: S1 is the core invariant/approval/control proof; S2 owns clean-Anvil end-to-end execution/recovery evidence.
- Recorded the WS-005 Phase-1 S1 slice separately from the later Phase-3 integrated pre-sign/broadcast/recovery slice, removing the previous circular dependency that required Phase-2 work before S1 could open Phase 2.
- Replaced stale current-status snapshots and obsolete migration/test counts with the current 21-migration, 71-DB, 18-concurrency and 7-invariant evidence.
- Phase 0 is marked S0 PASS under the Product Spec. The sole-maintainer repository still does not claim a separate GitHub-account approval; that remains explicit merge-governance risk R-019.

### Earlier Phase-0/1 foundation

The repository already contains canonical governing docs/ADRs, strict provider-neutral schemas, deterministic policy/lifecycle rules, atomic PostgreSQL budget accounting, append-only correlated audit, checkout-isolated local services, control fences, authenticated component recovery, MIT licensing, secret scanning, Dependabot and protected GitHub Actions.
