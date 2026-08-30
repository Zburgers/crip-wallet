import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { z } from "zod";

import type {
  SignAuthorizedTransferIds,
  SignerRefusalCode,
} from "./signer-core.js";

const componentAuthorizationSchema = z.strictObject({
  credentialId: z.string().regex(/^[A-Za-z0-9._:-]+$/),
  componentId: z.string().regex(/^[A-Za-z0-9._:-]+$/),
  role: z.enum(["ADAPTER", "RECONCILER"]),
  signature: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

const phaseNoticeSchema = z.strictObject({
  phase: z.enum(["signing-started", "evidence-persisted"]),
});

const signerResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    fromDurableEvidence: z.boolean(),
    authorization: componentAuthorizationSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string().min(1),
    freshnessCode: z.string().min(1).optional(),
  }),
]);

export type SignerResponse = z.infer<typeof signerResponseSchema>;

export interface SignerClientResult {
  ok: boolean;
  transactionHash?: string;
  fromDurableEvidence?: boolean;
  authorization?: z.infer<typeof componentAuthorizationSchema>;
  code?: SignerRefusalCode;
  freshnessCode?: string;
  /** Non-secret phase notices emitted by the child, in order. */
  phases: string[];
}

export interface SpawnSignerOptions {
  /** Repository root; the child resolves runtime and secrets from it. */
  root: string;
  ids: SignAuthorizedTransferIds;
  /** Extra milliseconds before the child is killed; default 30s. */
  timeoutMs?: number;
  /** Signal used when the timeout fires. */
  killSignal?: NodeJS.Signals;
  /** Resolve as soon as this phase notice is observed (crash testing). */
  waitForPhase?: "signing-started" | "evidence-persisted";
}

/**
 * Spawn the isolated signer child process and relay one IDs-only request.
 * No secret material is placed in argv or the environment; the child loads
 * keys itself from mode-0600 local state.
 */
export const spawnSignerProcess = (
  options: SpawnSignerOptions,
): Promise<SignerClientResult> => {
  const entry = join(
    options.root,
    "adapters/local-anvil/dist/src/signer-process.js",
  );
  const child = spawn(process.execPath, [entry], {
    cwd: options.root,
    stdio: ["pipe", "pipe", "pipe"],
    env: {},
  });
  const phases: string[] = [];
  let response: SignerResponse | undefined;
  return new Promise<SignerClientResult>((resolve) => {
    const timer = setTimeout(
      () => child.kill(options.killSignal ?? "SIGKILL"),
      options.timeoutMs ?? 30_000,
    );
    const finish = (result: SignerClientResult) => {
      clearTimeout(timer);
      resolve(result);
    };
    const readline = createInterface({ input: child.stdout });
    readline.on("line", (line) => {
      const parsed = signerResponseSchema.safeParse(
        (() => {
          try {
            return JSON.parse(line);
          } catch {
            return undefined;
          }
        })(),
      );
      if (parsed.success) {
        response = parsed.data;
        return;
      }
      const notice = phaseNoticeSchema.safeParse(
        (() => {
          try {
            return JSON.parse(line);
          } catch {
            return undefined;
          }
        })(),
      );
      if (notice.success) {
        phases.push(notice.data.phase);
        if (
          options.waitForPhase !== undefined &&
          notice.data.phase === options.waitForPhase
        )
          child.kill("SIGKILL");
      }
    });
    child.on("error", () => finish({ ok: false, code: "INTERNAL", phases }));
    child.on("close", () => {
      if (!response) {
        finish({ ok: false, code: "INTERNAL", phases });
        return;
      }
      if (response.ok) {
        finish({
          ok: true,
          transactionHash: response.transactionHash,
          fromDurableEvidence: response.fromDurableEvidence,
          authorization: response.authorization,
          phases,
        });
        return;
      }
      finish({
        ok: false,
        code: response.code as SignerRefusalCode,
        ...(response.freshnessCode === undefined
          ? {}
          : { freshnessCode: response.freshnessCode }),
        phases,
      });
    });
    child.stdin.write(`${JSON.stringify(options.ids)}\n`);
    child.stdin.end();
  });
};
