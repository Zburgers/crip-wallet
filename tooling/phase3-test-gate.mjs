import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const files = [
  "tests/db/autonomous-authorization.test.ts",
  "tests/db/execution-evidence.test.ts",
  "tests/db/wp05-recovery.test.ts",
  "tests/adversarial/p2-06c-substitution-recon.test.ts",
  "adapters/local-anvil/test/broadcast-core.test.ts",
  "adapters/local-anvil/test/chain-mutation-lease.test.ts",
  "adapters/local-anvil/test/fault-proxy.test.ts",
  "adapters/local-anvil/test/p2-06b-broadcast-crash.test.ts",
  "adapters/local-anvil/test/rpc-gateway.test.ts",
  "adapters/local-anvil/test/signer-core.test.ts",
  "packages/transaction-pipeline/test/chain-evidence.test.ts",
  "packages/transaction-pipeline/test/simulation.test.ts",
];

const missing = files.filter((file) => !existsSync(join(repoRoot, file)));
if (missing.length > 0) {
  process.stderr.write(
    `ERROR: Phase-3 gate is fail-closed; required suites are missing: ${missing.join(", ")}\n`,
  );
  process.exit(1);
}

process.stdout.write(`Phase-3 gate: ${files.join(", ")}\n`);
const result = spawnSync(
  process.execPath,
  [
    join(repoRoot, "node_modules/vitest/vitest.mjs"),
    "run",
    ...files,
    "--pool=forks",
    "--maxWorkers=1",
    "--no-file-parallelism",
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

process.exit(result.status ?? 1);
