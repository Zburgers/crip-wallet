# Phase 3 Execution Handoff

## Canonical start

- Repository: `Zburgers/crip-wallet`
- Canonical implementation branch: `phase-3/ws-005-implementation`, created
  from protected `main` after the Phase-3 planning PR and ADR-0018 were
  accepted/merged.
- Planning authority: `docs/plans/PHASE-3.md`
- Status: Phase 3 / WS-005 is **IN PROGRESS; P3-01 THROUGH P3-03 CLEARED; P3-04 LOCALLY IMPLEMENTED, EXACT-SHA REVIEW/CI PENDING** on
  `phase-3/ws-005-implementation`. P3-03 candidate
  `510763b3c9c217f9058b1c9d388ce02d84e6ae9e` passed fresh MAX review (9/10,
  confidence 0.90, no findings), CI `35498889238`, and Secret Scan
  `35498889228`. P3-04 local gates pass (check 21 repository + 363 package
  tests; DB 161/161, including control/recovery/envelope replacement, approval
  replay, autonomous authorization, signer, and broadcaster lock-order races).
  P3-04 exact-SHA review and protected CI/Secret Scan are pending; P3-05–P3-06
  remain gated.
- Boundary: loopback Anvil `eip155:31337`, fake ERC-20, disposable local
  identities only. Public networks, real value, and production custody remain
  prohibited.

## Read before work

1. `docs/PRODUCT_SPEC.md`
2. `docs/plans/PHASE-3.md`
3. `docs/decisions/ADR-0018-integrated-control-send-commit.md`
4. ADR-0003, 0005, 0008, 0011, 0014, 0015, 0016, and 0017
5. `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/SECURITY.md`
6. `docs/plans/PHASE-1.md`, `docs/plans/PHASE-2.md`
7. `docs/TEST_MATRIX.md`, `docs/RISK_REGISTER.md`, and WS-004/WS-005

## Frozen decisions

- Existing four fence versions plus immutable authorization ID are the authority
  epoch; do not create another epoch system.
- Signing and signed-evidence persistence are one bounded fence-first DB
  transaction. Chain facts carry a bounded freshness/lock deadline; no RPC
  occurs while DB locks are held.
- `STARTED` insertion performs a second full authority check and its commit is
  the send-commit linearization point.
- Signed/no-attempt control changes become `DISPUTED`, retain value, and cannot
  broadcast. Exact DB proof of zero attempts enables authenticated recovery.
- `STARTED` and later cannot be cancelled, released, re-signed, repriced, or
  blocked from exact-evidence reconciliation by a later control change.
- Recovery uses immutable attempt/hash evidence plus a DB-time lease version;
  retries never create new authority or economic effects.
- Migration `0026` must replace the Phase-1 invalidation trigger with the
  unsigned/signed-no-attempt/existing-attempt matrix and fence disputed release.
- The restricted execution composition is the sole raw-send gateway; no raw
  send is possible without its matching committed `STARTED` row.
- Reuse existing lifecycle states and tables except the minimum forward-only
  migration/constraints defined by the plan.

## P3-01 R-033 implementation

The selected local consistency boundary is a checkout-scoped exclusive
Anvil-mutation lease. Host RPC uses the loopback-published gateway; Anvil is
unpublished on the internal network. Every supported mutator and the signer
share `.local/coordination/anvil.lock`. The signer acquires it before the final
freshness RPC and holds it through signing/evidence commit, so no chain RPC
runs under PostgreSQL locks. The gateway checkpoints each mutation and fails
closed if durable state cannot be verified. `dev-up`/`dev-down` serialize
container lifecycle with the same lease. See `docs/plans/PHASE-3.md` for the
implementation and live runtime evidence.

## Packet order

```text
ADR-0018 accepted
  -> P3-01 pre-sign atomic authority/signing boundary
  -> P3-02 signed-unbroadcast quarantine/control
  -> P3-03 send commit + UNKNOWN/recovery integration
  -> P3-04 control/recovery concurrency + stale-worker fence
  -> P3-05 adversarial/fault matrix
  -> P3-06 clean-room gate + independent closeout
```

P3-01 through P3-04 are strictly sequential because they own one migration,
lock order, and transition model. After the P3-04 SHA is frozen, P3-05 may use
up to three disjoint test-only workers: DB/concurrency, signer/broadcast fault,
and chain/audit/adversarial. Integrate them sequentially. P3-06 is sequential.

## Validation discipline

- Test-drive every security transition with deterministic barriers; no sleep-
  based race proof.
- Run packet-focused tests, `npm run check`, and `npm audit --audit-level=high`
  for every packet.
- Run the exact clean-room commands in `docs/plans/PHASE-3.md` for P3-06, then
  require protected CI and Secret Scan on the exact candidate SHA.
- Record runtime/container/fixture ownership and prove cleanup. Preserve any
  unrelated dirty work and never stop unproven shared resources.
- After every completed packet push, run a fresh GPT-5.6 Luna MAX critic against
  the exact SHA. Remediate real findings, push the fix, and repeat with a fresh
  critic before advancing to the next sequential packet.
- After P3-05 and before P3-06, freeze a candidate and run two fresh MAX
  critics: one for security/races/economic integrity and one for product and
  implementation quality.

## Stop/escalate

Stop the affected packet if ADR-0018 is unaccepted; authority/attempt identity
cannot be proven; raw bytes must escape the child; a migration cannot fail
closed; a send-capable result would need cancellation/re-sign/release; scope
widens toward public networks/real funds/production custody; or any critical/
high finding remains. Begin P3-04 only after P3-03 local gates, fresh
exact-SHA review, and protected CI/Secret Scan pass.

## Completion

Phase 3 is complete only when P3-01 through P3-06 are integrated, ADR-0018 is
accepted, every Phase-3 and inherited S0/S1/S2 gate passes at the exact head,
protected CI/Secret Scan are green, independent review is clear, documentation
matches behavior, and clean teardown/local-only refusal are proven. A planning
merge is not implementation completion.
