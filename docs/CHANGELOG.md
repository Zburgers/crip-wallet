# Changelog

Owner: lead orchestrator.
Update rule: record user/operator-visible, schema, security, policy, compatibility, dependency, or governance-authority changes in the same integration change.

## Unreleased

### Phase 2

- Phase 2 / WS-004 merged to `main` through canonical PR #5 at `2c7e50f6aee6887ddd4af74c7bc33639707451b4` after final main-merge review `5126534096`. Post-merge `main` CI `34058182763` and Secret Scan `34058183008` pass the complete Phase-2 protected gate. S2 remains ACCEPTED only for the governing local Anvil `eip155:31337` / fake-ERC20 / disposable-identity boundary; Phase 3 remains NOT OPENED.

- Final Phase-2 closeout: external S2 acceptance review `5126373971` accepted the governing local fake-ERC20 MVP boundary; PR #17 merged at canonical SHA `34e0b53af07abff20fc36a737c17d6b0107e57bc`. Phase 2 / WS-004 is COMPLETE / ACCEPTED, the scope remains local-only, and Phase 3 is not opened.

- Reconciled final S2 evidence provenance in the docs-only P2-06D remediation: S2 requirement evidence is PASS while Gate S2 remains OPEN / NOT PASSED pending external acceptance; corrected final P2-05D/P2-06A accepted heads and recorded the protected P2-06D implementation/evidence head `6efdfd7c91b437da94b8b0e84e929f01b7aa4f46`. Fresh checks for the new docs-only head are recorded in PR #17.

- Completed P2-06D / evidence package ready from canonical SHA `7f3be19b75b798739e002ff15ece9250cfecd04b`: added explicit protected CI steps for `npm run test:fault` and `npm run test:adversarial`, fixed an expected-rejection timing race in the real-store expiry test, and recorded fresh local evidence of check `21 + 344`, Forge `10/10`, chain `10/10`, E2E `1/1`, DB `126/126`, concurrency `18/18`, invariants `7/7`, fault `133/133`, adversarial `169/169`, and audit `0`. Phase 2 implementation is complete pending external S2 review; S2 remains OPEN / NOT PASSED / READY FOR EXTERNAL REVIEW.

- Integrated externally accepted P2-06B and P2-06C on `integration/p2-06bc` from canonical base `b27202edac48cd183ec1bac8856b905447d91f49`; preserved the complete P2-06B remediation range, added the substitution/reconciliation matrix, and kept P2-06D pending. Combined local evidence is fault 133/133, adversarial 169/169, DB 126/126, concurrency 18/18, invariants 7/7, chain 10/10, E2E 1/1, Forge 10/10, check 21 repository + 344 Vitest, and audit 0 high vulnerabilities. S2 remains OPEN / NOT PASSED.

- Integrated P2-06A on canonical Phase-2 branch `phase-2/ws-004-local-erc20` (PR #5; P2-05 ACCEPTED; PRs #8 and #12 merged/closed): deterministic loopback Anvil fault proxy, method-aware fault modes, request/forward barriers, exact counters, receipt release, runtime validation and raw-transaction redaction. P2-06B/C/D remain pending; S2 remains OPEN / NOT PASSED.

- Completed P2-05D remediation on `integration/p2-05d` code SHA `a45c32d46330230614c8a72b44c0941dd0cf1850`: integrated PRE-A canonical autonomous authorization with PRE-B signer-local execution, preserved owner-approval fence snapshots, bound preparation ID collisions, ordered final policy evaluation after exact executable verification, and added an explicit protected E2E step. Local evidence is 1/1 E2E, 122/122 DB, 18/18 concurrency, 7/7 invariants, 10/10 chain, 10/10 Forge, 21 repository + 314 Vitest, and 0 high audit vulnerabilities. Protected CI `33441013501` and Secret Scan `33441013543` pass on that exact code SHA; S2 remains OPEN / NOT PASSED pending external acceptance review.
- Corrected the ERC-20 Transfer event topic for new P2-05 evidence in forward migration 0024 without editing migrations 0001–0023; existing rows with the legacy incorrect topic remain unverifiable and fail closed.

- Opened Phase 2 / WS-004 from current `main` for the local fake-ERC-20 vertical slice: construct, independently verify, simulate, authorize, locally sign, broadcast, confirm and reconcile.
- Added `docs/plans/PHASE-2.md` and `docs/workstreams/WS-004-transaction-pipeline.md` with explicit local-only boundaries, packet order, S2 evidence requirements and chain-level ambiguity/fault coverage.
- Preserved the prohibition on public RPC, testnet/mainnet, real funds, production custody and production identity.
