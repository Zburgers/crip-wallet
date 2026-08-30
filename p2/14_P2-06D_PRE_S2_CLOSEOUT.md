# Agent Prompt — P2-06D: Integrate Adversarial Suites + Prepare External S2 Evidence

## Common authority / hard rules

Work **only** in `https://github.com/Zburgers/crip-wallet`. Governing authority: `docs/PRODUCT_SPEC.md`, `docs/plans/PHASE-2.md`, `docs/workstreams/WS-004-transaction-pipeline.md`, and accepted ADRs, especially ADR-0015. Use Shipyard executing-plans/TDD/verification/security workflows where available.

Phase 2 is strictly local fake-money only: loopback Anvil `31337` / `eip155:31337`, disposable accounts, fake ERC-20. Never add public RPC, testnet/mainnet, real funds, production custody, existing wallet material, arbitrary raw/message/EIP-712 signing, swaps, bridges, DeFi, Permit/Permit2, or a generic call/sign surface.

Preserve: envelope v1 semantics/vectors; migrations `0001`-`0021`; `allocated = available + reserved + finalized_spend`; token budget and native gas as separate assets; canonical authorization/fences; ambiguity retains funds; RPC evidence is untrusted; ADR-0014 authenticated RECONCILER evidence gates economic mutation. Accepted ADRs are not silently rewritten.

Parallel-work discipline: start from the **coordinator-provided integration SHA**, create a dedicated branch/worktree, do not push unrelated changes, do not merge parent PR #5, and do not edit files explicitly owned by a concurrent packet. Return exact commit SHA(s), files, tests/counts, and gaps. Never claim protected evidence you did not actually obtain.

STOP rather than improvise if an accepted ADR must change, v1 would change, a Phase-1 migration must change, a second authorization/transaction source of truth seems necessary, a public/real-network path appears, or S0/S1 regresses.

## Mission
Integrate P2-06A/B/C with reviewed P2-05, wire real fail-closed commands/CI, run clean-room full Phase-2 gate, update evidence docs. **Do not self-accept S2.**

## Integration review
Confirm fault proxy test-only/loopback; B UNKNOWN semantics match P2-05; C covers every v2 field; no weakened guards or duplicate authority. Resolve conflicts by governing contracts.

## Required real commands
```bash
npm ci
npm run check
npm audit --audit-level=high
npm run dev:up
npm run dev:status
npm run contracts:test
npm run fixture:phase2
npm run test:db
npm run test:concurrency
npm run test:invariants
npm run test:chain
npm run test:fault
npm run test:adversarial
npm run dev:down
```
Required suites cannot be no-op/passWithNoTests. Cleanup must run on failure.

## Evidence
From fresh/current checkout record integration SHA, exact suite counts, property/concurrency counts, dependency audit, fixture/tool versions per repo convention, permissions/redaction checks. Push and require protected CI + Secret Scan green; record run IDs.

## Living docs
Truthfully update PROJECT_STATE, ROADMAP, TEST_MATRIX, TESTING, RISK_REGISTER, THREAT_MODEL, CHANGELOG, WS-004 and PHASE-2 status/checklist as needed. State **P2-06 COMPLETE / READY FOR EXTERNAL S2 ACCEPTANCE REVIEW**, not S2 accepted. Do not claim production/public-network/Phase-3 guarantees.

## Final security inspection
No public/testnet/mainnet RPC, real wallet material, raw signing surface, secret/raw-byte logs, caller tx fields reaching signer, unauthenticated reconciliation, release-on-timeout, v1 mutation, edits to 0001-0021, gas/token conflation, skipped/no-op gates.

## Handoff
Evidence table: head SHA, commands/results/counts, protected CI run ID, Secret Scan run ID, unresolved findings, docs changed, S2 criteria ready for reviewer. Verdict only: `P2-06 COMPLETE — READY FOR EXTERNAL S2 ACCEPTANCE REVIEW` or remediation required. Never output `S2 ACCEPTED`.
