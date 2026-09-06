import { pathToFileURL } from "node:url";
import { join } from "node:path";
import process from "node:process";

import { Pool } from "pg";

import { signAuthorizedTransferCore } from "./signer-core.js";
import { createLocalSignerDeps } from "./signer-keys.js";
import { createSignerStore } from "./signer-store.js";

interface LocalRuntime {
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  anvil: { host: string; port: number; rpcUrl: string };
}

const readStdin = async (): Promise<string> => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk.toString();
  return input;
};

/**
 * Child-process signer entry. Reads one IDs-only JSON request from stdin and
 * writes one non-secret JSON response to stdout. Secrets are loaded inside
 * this process from mode-0600 local state, never from argv or the environment.
 */
export const runSignerProcess = async (): Promise<number> => {
  const root = process.cwd();
  const { loadLocalRuntime } = (await import(
    pathToFileURL(join(root, "tooling/local-runtime.mjs")).href
  )) as { loadLocalRuntime: (input: { root: string }) => LocalRuntime };
  const runtime = loadLocalRuntime({ root });
  const deps = createLocalSignerDeps({
    rpcUrl: runtime.anvil.rpcUrl,
    root,
  });
  const pool = new Pool({
    host: runtime.postgres.host,
    port: runtime.postgres.port,
    database: runtime.postgres.database,
    user: runtime.postgres.user,
    password: runtime.postgres.password,
    max: 1,
  });
  try {
    const request = JSON.parse((await readStdin()) || "null") as unknown;
    const outcome = await signAuthorizedTransferCore(
      {
        ...deps,
        store: createSignerStore(pool),
        now: () => new Date(),
        onPhase: (phase) => {
          process.stdout.write(`${JSON.stringify({ phase })}\n`);
        },
      },
      request,
    );
    const response = outcome.ok
      ? {
          ok: true as const,
          transactionHash: outcome.transactionHash,
          fromDurableEvidence: outcome.fromDurableEvidence,
          authorization: outcome.authorization,
        }
      : {
          ok: false as const,
          code: outcome.code,
          ...(outcome.freshnessCode === undefined
            ? {}
            : { freshnessCode: outcome.freshnessCode }),
        };
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return 0;
  } catch {
    // Never leak error text, stack traces, or key material to stdout/stderr.
    process.stdout.write(
      `${JSON.stringify({ ok: false, code: "INTERNAL" })}\n`,
    );
    return 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
};

if (process.argv[1] && process.argv[1].endsWith("signer-process.js")) {
  void runSignerProcess().then((code) => {
    process.exitCode = code;
  });
}
