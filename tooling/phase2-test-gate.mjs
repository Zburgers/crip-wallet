import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const suite = process.argv[2] ?? "";
const requested = process.argv.slice(3).filter((value) => value !== "--");

if (suite !== "chain") {
  process.stderr.write(
    `ERROR: unknown Phase-2 suite ${JSON.stringify(suite)}.\n`,
  );
  process.exit(2);
}

const chainRoot = join(repoRoot, "tests", "chain");
const available = existsSync(chainRoot)
  ? readdirSync(chainRoot)
      .filter((name) => /\.(?:test|spec)\.ts$/.test(name))
      .map((name) => join("tests", "chain", name))
  : [];
const files =
  requested.length > 0
    ? requested.map((name) => join("tests", "chain", name))
    : available;

if (
  files.length === 0 ||
  files.some((file) => !existsSync(join(repoRoot, file)))
) {
  process.stderr.write(
    `ERROR: ${suite} gate is fail-closed; requested or discovered test suite is missing.\n`,
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    join(repoRoot, "node_modules/vitest/vitest.mjs"),
    "run",
    ...files.map((file) => relative(repoRoot, join(repoRoot, file))),
    "--pool=forks",
    "--maxWorkers=1",
    "--no-file-parallelism",
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

process.exit(result.status ?? 1);
