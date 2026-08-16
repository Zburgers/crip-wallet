import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";

import { loadLocalRuntime } from "./local-runtime.mjs";
import { PHASE1_TEST_PARAMETERS } from "./phase1-test-parameters.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const gate = process.argv[2] ?? "";
/** @param {string} message */
const log = (message) => process.stdout.write(`${message}\n`);
/** @param {string} message */
const error = (message) => process.stderr.write(`${message}\n`);

/** @type {Record<string, {label: string, maxWorkers: number, roots: string[]}>} */
const gateDefinitions = {
  concurrency: {
    label: "concurrency",
    maxWorkers: PHASE1_TEST_PARAMETERS.concurrency.workers,
    roots: ["tests/concurrency"],
  },
  db: {
    label: "database",
    maxWorkers: 1,
    roots: ["tests/db"],
  },
  invariants: {
    label: "invariant/property",
    maxWorkers: 1,
    roots: ["packages"],
  },
};

const definition = gateDefinitions[gate];
if (!definition) {
  error(
    `ERROR: unknown Phase-1 gate ${JSON.stringify(gate)}; expected db, concurrency, or invariants.`,
  );
  process.exit(2);
}

/** @param {string} directory @returns {string[]} */
const collectFiles = (directory) => {
  if (!statSync(directory).isDirectory()) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(path);
    if (!entry.isFile() || !/\.(?:test|spec)\.(?:mjs|ts)$/.test(entry.name)) {
      return [];
    }
    if (gate === "invariants" && !/(?:property|invariant)/i.test(entry.name)) {
      return [];
    }
    return [path];
  });
};

const files = definition.roots.flatMap((root) => {
  const absolute = join(repoRoot, root);
  try {
    return collectFiles(absolute);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return [];
    }
    throw error;
  }
});

if (files.length === 0) {
  error(
    `ERROR: ${definition.label} gate is fail-closed; no test files were found under ${definition.roots.join(", ")}.`,
  );
  error(
    "Add the required suite before promoting this gate; an empty suite may not report a false pass.",
  );
  process.exit(1);
}

const relativeFiles = files.map((file) => relative(repoRoot, file));
log(`Phase-1 ${definition.label} gate: ${relativeFiles.join(", ")}`);
if (gate === "invariants") {
  log(
    `Property parameters: lifecycleSeed=${PHASE1_TEST_PARAMETERS.invariants.lifecycleSeed} malformedInputSeed=${PHASE1_TEST_PARAMETERS.invariants.malformedInputSeed} eventSequenceSeed=${PHASE1_TEST_PARAMETERS.invariants.eventSequenceSeed} numRuns=${PHASE1_TEST_PARAMETERS.invariants.numRuns}`,
  );
}
if (gate === "concurrency") {
  const parameters = PHASE1_TEST_PARAMETERS.concurrency;
  log(
    `Concurrency parameters: workers=${parameters.workers} rounds=${parameters.rounds} barrier=${parameters.barrier} barrierTimeoutMs=${parameters.barrierTimeoutMs}`,
  );
}
if (gate === "db") {
  const parameters = PHASE1_TEST_PARAMETERS.database;
  const runtime = loadLocalRuntime({ root: repoRoot });
  log(
    `Database runtime: host=${runtime.postgres.host} port=${runtime.postgres.port} database=${parameters.database} user=${parameters.user}`,
  );
}
if (gate === "concurrency") {
  const runtime = loadLocalRuntime({ root: repoRoot });
  log(
    `Concurrency database runtime: host=${runtime.postgres.host} port=${runtime.postgres.port} database=${runtime.postgres.database} user=${runtime.postgres.user}`,
  );
}

const result = spawnSync(
  process.execPath,
  [
    join(repoRoot, "node_modules/vitest/vitest.mjs"),
    "run",
    ...relativeFiles,
    "--pool=forks",
    `--maxWorkers=${definition.maxWorkers}`,
    "--no-file-parallelism",
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

process.exit(result.status ?? 1);
