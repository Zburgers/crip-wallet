# Razorctl Phase 2.3 — Bounded P2-18 stopped-verifier semantic fix

You are performing one **small, bounded follow-up remediation** on the Phase 2.3 Tranche I implementation.

This is NOT a new tranche and NOT P2-20.

## Repository / branch

Repository: `Zburgers/naki-ops`

Branch: `feat/razorctl-actions-v1`

PR: `#11`

Required starting SHA:

`e8df08dfbe4ab10d4f50c1b9d7a52a72e750d774`

Before work:

```bash
git fetch origin --prune
git switch feat/razorctl-actions-v1
git pull --ff-only origin feat/razorctl-actions-v1
git rev-parse HEAD
git status --short
```

Require exact HEAD and a clean worktree.

If HEAD moved, stop and inspect the intervening commits before changing anything.

## Read first

- `docs/specs/2026-08-28-razorctl-phase-2.3-actions-design.md`
- `docs/plans/2026-08-28-razorctl-phase-2.3-implementation.md`
- PR #11 comment `5455432372`

Relevant normative design:

- Docker `running` + policy verifier healthy -> `noop`
- Docker `running` + policy verifier known unhealthy -> `approval_required/restart_running`
- Docker `stopped`/`exited` + complete configuration/guards + `allow_start_stopped=true` -> `approval_required/start_stopped`
- post-action success later requires mandatory typed verifier proof

## Bug to fix

At the current remediation head:

- `searxng_local_http_v1` returns a typed known result only when the target is already running;
- `EvaluateRestart` globally requires `snapshot.Target.Verifier.Known` before entering the Docker raw-state matrix;
- therefore a real stopped/exited SearXNG cannot ever produce the reviewed `start_stopped` approval.

This is safety-conservative but semantically incorrect and breaks the accepted P2-18 matrix.

## Required behavior

Separate:

1. **verifier contract availability/identity**
2. **current runtime verifier outcome**

For all action planning:

- the configured verifier name must be registered/recognized;
- the verifier implementation identity must match canonical policy;
- missing/unregistered/mismatched verifier contract => UNKNOWN/no plan or contract failure according to existing accepted semantics.

For Docker RUNNING:

- require fresh typed verifier evidence;
- known healthy -> `noop` if all other predicates are safe;
- known unhealthy -> `approval_required/restart_running` if all other predicates are safe;
- unknown/stale verifier -> UNKNOWN/no plan.

For Docker STOPPED/EXITED:

- do NOT require the application endpoint to be currently healthy or currently reachable;
- do NOT require `Verifier.Known == true` if the verifier cannot meaningfully establish an application postcondition while the service is stopped;
- still require:
  - recognized configured verifier implementation;
  - complete fresh raw lifecycle evidence;
  - full configuration-profile coverage;
  - safe guards;
  - valid action identity/source/build/tree/executable contract;
  - no non-state configuration drift;
  - `allow_start_stopped=true`;
- then return `approval_required` with strategy `start_stopped`.

The typed verifier remains mandatory for P2-20 **post-action verification** before any execution result may become `completed`.

Do not weaken the running-state verifier requirement to make tests pass.

## Preferred implementation shape

Keep the change small.

A clean approach is to move the `Verifier.Known` requirement into the raw-state branches that actually require a live current verifier outcome.

The evaluator must still prove the configured verifier contract itself exists/matches before any eligible plan is issued.

If useful, add a closed field/predicate distinguishing:

- verifier implementation recognized/configured;
- runtime verification known/healthy/fresh.

Do not add generic URLs or caller-supplied verification endpoints.

## TDD requirements

Write red tests first.

At minimum add tests for:

1. Docker running + known healthy typed verifier -> noop.
2. Docker running + known unhealthy typed verifier -> approval required / `restart_running`.
3. Docker running + unknown verifier -> UNKNOWN / no plan.
4. Docker stopped + recognized configured verifier contract + runtime verifier unknown + all other prerequisites safe + `allow_start_stopped=true` -> approval required / `start_stopped`.
5. Docker exited -> same.
6. Docker stopped/exited + missing/unregistered verifier implementation -> UNKNOWN/no plan.
7. Docker stopped/exited + verifier implementation mismatch -> UNKNOWN/no plan or contract failure per accepted contract.
8. Docker stopped/exited + non-state drift -> blocked.
9. Docker stopped/exited + unsafe/unknown guard -> blocked/unknown.
10. Docker stopped/exited + `allow_start_stopped=false` -> blocked.
11. Ensure plan mode remains non-mutating and actionstate is untouched.

Prefer service-level tests through the real snapshot/verifier seam where practical, not only manually constructed evaluator fixtures.

## Documentation clarification

Make a minimal clarification in the Phase 2.3 design/implementation docs if needed:

For known stopped/exited targets eligible for `start_stopped`, the configured verifier **contract/implementation must be present and valid**, but a currently healthy application verifier outcome is not required because the application is expected to be down. Post-action success still requires fresh known healthy verifier evidence.

Do not redesign Phase 2.3.

## Hard scope boundary

Do NOT implement:

- PM2 restart/start execution;
- Docker restart/start execution;
- public `razorctl restart`;
- remote restart protocol;
- live action policy enablement;
- systemd mutation;
- shell/sudo;
- arbitrary argv/env/Cwd;
- retries/rollback/self-healing;
- daemon/listener/MCP.

P2-20 remains NOT STARTED.

## Quality gates

Run:

```bash
cd tools/razorctl
GOTOOLCHAIN=auto gofmt -w .
GOTOOLCHAIN=auto go test ./...
GOTOOLCHAIN=auto go test -race ./...
GOTOOLCHAIN=auto go vet ./...
GOTOOLCHAIN=auto govulncheck ./...
GOTOOLCHAIN=auto go mod tidy
git diff --exit-code -- go.mod go.sum
GOTOOLCHAIN=auto go build -trimpath -o ./bin/razorctl ./cmd/razorctl
```

From repo root:

```bash
bash skills/razor-crest-ops/tests/scripts.sh
git diff --check
```

Also statically confirm no mutation executor/public restart/live policy was introduced.

## Commit / push

Commit only this bounded correction and any minimal documentation/test updates.

Suggested commit:

`fix(razorctl): allow safe stopped restart planning`

Push normally. No force push.

Keep PR #11 OPEN / DRAFT / UNMERGED.

## Final report

Return:

- starting SHA;
- commit SHA;
- final pushed SHA;
- files changed;
- exact semantic fix;
- tests added;
- quality-gate results;
- confirmation no live policy enabled;
- confirmation no PM2/Docker mutation executor exists;
- confirmation no public restart surface exists;
- confirmation P2-20 NOT STARTED;
- final verdict: `READY FOR INDEPENDENT TRANCHE I RE-REVIEW` or `BLOCKED`.
