import { pathToFileURL } from "node:url";
import { join } from "node:path";
import process from "node:process";

import { Pool } from "pg";

import { createBroadcastStore } from "./broadcast-store.js";
import { executeAuthorizedTransferCore } from "./execution-core.js";
import { createExecutionSerializationStore } from "./execution-store.js";
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
  anvil: { rpcUrl: string };
}

const readStdin = async (): Promise<string> => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk.toString();
  return input;
};

/** Restricted child composition: raw bytes exist only inside this process. */
export const runExecutionProcess = async (): Promise<number> => {
  const root = process.cwd();
  let pool: Pool | undefined;
  try {
    const { loadLocalRuntime } = (await import(
      pathToFileURL(join(root, "tooling/local-runtime.mjs")).href
    )) as { loadLocalRuntime: (input: { root: string }) => LocalRuntime };
    const runtime = loadLocalRuntime({ root });
    const localSigner = createLocalSignerDeps({
      rpcUrl: runtime.anvil.rpcUrl,
      root,
    });
    pool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 2,
    });
    const request = JSON.parse((await readStdin()) || "null") as unknown;
    const outcome = await executeAuthorizedTransferCore(
      {
        ...localSigner,
        store: createSignerStore(pool),
        broadcastStore: createBroadcastStore(pool),
        executionStore: createExecutionSerializationStore(pool),
        sender: { sendRawTransaction: localSigner.sendRawTransaction },
        now: () => new Date(),
        onPhase: (phase) =>
          process.stdout.write(`${JSON.stringify({ phase })}\n`),
      },
      request,
    );
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    return outcome.ok ? 0 : 1;
  } catch {
    // Never expose error text, stack traces, keys, or raw bytes.
    process.stdout.write(
      `${JSON.stringify({ ok: false, code: "INTERNAL" })}\n`,
    );
    return 1;
  } finally {
    await pool?.end().catch(() => undefined);
  }
};

if (process.argv[1] && process.argv[1].endsWith("execution-process.js")) {
  void runExecutionProcess().then((code) => {
    process.exitCode = code;
  });
}
