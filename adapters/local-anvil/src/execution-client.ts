import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { z } from "zod";

import type { SignAuthorizedTransferIds } from "./signer-core.js";

const authorizationSchema = z.strictObject({
  credentialId: z.string().regex(/^[A-Za-z0-9._:-]+$/),
  componentId: z.string().regex(/^[A-Za-z0-9._:-]+$/),
  role: z.enum(["ADAPTER", "RECONCILER"]),
  signature: z.string().regex(/^[A-Za-z0-9_-]+$/),
});
const phaseSchema = z.strictObject({
  phase: z.enum(["signing-started", "evidence-persisted", "broadcast-started"]),
});
const metadata = {
  operationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  authorizationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  adapterRequestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  signedTransactionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  expectedTransactionHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  broadcastAttemptId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  broadcastStatus: z.enum([
    "STARTED",
    "ACCEPTED",
    "REJECTED",
    "UNKNOWN",
    "CONFLICT",
  ]),
  fromDurableEvidence: z.boolean(),
};
const responseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    ...metadata,
    broadcastStatus: z.literal("ACCEPTED"),
    rematerializedBeforeSend: z.boolean(),
    authorization: authorizationSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string().min(1),
    broadcastStatus: metadata.broadcastStatus.optional(),
    operationId: metadata.operationId.optional(),
    authorizationId: metadata.authorizationId.optional(),
    adapterRequestId: metadata.adapterRequestId.optional(),
    signedTransactionId: metadata.signedTransactionId.optional(),
    expectedTransactionHash: metadata.expectedTransactionHash.optional(),
    broadcastAttemptId: metadata.broadcastAttemptId.optional(),
    fromDurableEvidence: z.boolean().optional(),
  }),
]);

export type ExecutionClientResult = z.infer<typeof responseSchema> & {
  phases: string[];
};

export interface SpawnExecutionOptions {
  root: string;
  ids: SignAuthorizedTransferIds;
  timeoutMs?: number;
  waitForPhase?: "signing-started" | "evidence-persisted" | "broadcast-started";
}

/** Parent IPC accepts only allowlisted phase notices and safe metadata. */
export const spawnExecutionProcess = (
  options: SpawnExecutionOptions,
): Promise<ExecutionClientResult> => {
  const child = spawn(
    process.execPath,
    [join(options.root, "adapters/local-anvil/dist/src/execution-process.js")],
    { cwd: options.root, stdio: ["pipe", "pipe", "pipe"], env: {} },
  );
  const phases: string[] = [];
  let response: z.infer<typeof responseSchema> | undefined;
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 30_000,
    );
    const finish = (value: z.infer<typeof responseSchema>) => {
      clearTimeout(timer);
      resolve({ ...value, phases });
    };
    const readline = createInterface({ input: child.stdout });
    readline.on("line", (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      const phase = phaseSchema.safeParse(parsed);
      if (phase.success) {
        phases.push(phase.data.phase);
        if (options.waitForPhase === phase.data.phase) child.kill("SIGKILL");
        return;
      }
      const result = responseSchema.safeParse(parsed);
      if (result.success) response = result.data;
    });
    child.on("error", () => finish({ ok: false, code: "INTERNAL" }));
    child.on("close", () =>
      finish(response ?? { ok: false, code: "INTERNAL" }),
    );
    child.stdin.write(`${JSON.stringify(options.ids)}\n`);
    child.stdin.end();
  });
};
