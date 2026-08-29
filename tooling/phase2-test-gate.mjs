import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const suite = process.argv[2] ?? "";
const requested = process.argv.slice(3).filter((value) => value !== "--");

const suiteRoots = {
  chain: { directory: join(repoRoot, "tests", "chain"), label: "tests/chain" },
  fault: {
    directory: join(repoRoot, "adapters", "local-anvil", "test"),
    label: "adapters/local-anvil/test",
  },
};

if (suite !== "chain" && suite !== "fault") {
  process.stderr.write(
    `ERROR: unknown Phase-2 suite ${JSON.stringify(suite)}.\n`,
  );
  process.exit(2);
}

const suiteConfig = suite === "chain" ? suiteRoots.chain : suiteRoots.fault;
const suiteRoot = suiteConfig.directory;
const available = existsSync(suiteRoot)
  ? readdirSync(suiteRoot)
      .filter((name) => /\.(?:test|spec)\.ts$/.test(name))
      .map((name) => join(suiteConfig.label, name))
  : [];
const requestedFiles = requested.map((name) => {
  const candidate = resolve(suiteRoot, name);
  const relativeToSuite = relative(suiteRoot, candidate);
  if (
    !relativeToSuite ||
    relativeToSuite.startsWith(`..${sep}`) ||
    isAbsolute(relativeToSuite) ||
    !/(?:\.test|\.spec)\.ts$/.test(relativeToSuite)
  ) {
    return null;
  }
  return join(suiteConfig.label, relativeToSuite);
});
const files =
  requested.length > 0
    ? requestedFiles.flatMap((file) => (file === null ? [] : [file]))
    : available;

if (
  files.length === 0 ||
  requestedFiles.some((file) => file === null) ||
  files.some((file) => !existsSync(join(repoRoot, file)))
) {
  process.stderr.write(
    `ERROR: ${suite} gate is fail-closed; requested tests must remain under ${suiteConfig.label} and exist.\n`,
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
