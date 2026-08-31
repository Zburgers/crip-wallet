import { authorizedTransferRequestSchema } from "@crip/adapter-sdk";

import {
  broadcastSignedTransaction,
  canonicalSignedTransactionHash,
  type BroadcastAttempt,
  type BroadcastStore,
  type RawTransactionSender,
} from "./broadcast-core.js";
import {
  signAuthorizedTransferCore,
  type SignAuthorizedTransferIds,
  type SignerDeps,
  type SignerRefusalCode,
} from "./signer-core.js";

export type {
  Address,
  DurableSignedEvidence,
  ExactTransactionFields,
  SignAuthorizedTransferIds,
  SignerDeps,
  SignerStore,
  SigningContext,
  SimulationRecord,
} from "./signer-core.js";

export interface ExecutionSerializationStore {
  /** Holds one per-operation PostgreSQL advisory lock through STARTED commit. */
  withExecutionLock<T>(operationId: string, work: () => Promise<T>): Promise<T>;
  /** Reads the existing lifecycle before deciding whether rematerialization is legal. */
  findBroadcastAttempt(
    ids: SignAuthorizedTransferIds,
  ): Promise<BroadcastAttempt | null>;
}

export interface ExecuteAuthorizedTransferDeps extends SignerDeps {
  broadcastStore: BroadcastStore;
  sender: RawTransactionSender;
  executionStore: ExecutionSerializationStore;
}

export interface ExecuteAuthorizedTransferSuccess {
  ok: true;
  operationId: string;
  authorizationId: string;
  adapterRequestId: string;
  signedTransactionId: string;
  expectedTransactionHash: `0x${string}`;
  broadcastAttemptId: string;
  broadcastStatus: "ACCEPTED";
  fromDurableEvidence: boolean;
  rematerializedBeforeSend: boolean;
  authorization: ReturnType<SignerDeps["authorizeResult"]>;
}

export interface ExecuteAuthorizedTransferFailure {
  ok: false;
  code: SignerRefusalCode | "BROADCAST_NOT_ACCEPTED";
  broadcastStatus?: BroadcastAttempt["status"];
  operationId?: string;
  authorizationId?: string;
  adapterRequestId?: string;
  signedTransactionId?: string;
  expectedTransactionHash?: `0x${string}`;
  broadcastAttemptId?: string;
  fromDurableEvidence?: boolean;
  rematerializedBeforeSend?: false;
}

export type ExecuteAuthorizedTransferOutcome =
  ExecuteAuthorizedTransferSuccess | ExecuteAuthorizedTransferFailure;

const safeResultPayload = (
  ids: SignAuthorizedTransferIds,
  transactionHash: `0x${string}`,
) => ({
  operationId: ids.operationId,
  authorizationId: ids.authorizationId,
  adapterRequestId: ids.adapterRequestId,
  transactionHash,
});

const lifecycleResult = (
  ids: SignAuthorizedTransferIds,
  attempt: BroadcastAttempt,
  fromDurableEvidence: boolean,
  rematerializedBeforeSend: boolean,
  authorize: (
    payload: Record<string, unknown>,
  ) => ReturnType<SignerDeps["authorizeResult"]>,
): ExecuteAuthorizedTransferOutcome => {
  const common = {
    operationId: ids.operationId,
    authorizationId: ids.authorizationId,
    adapterRequestId: ids.adapterRequestId,
    signedTransactionId: attempt.signedTransactionId,
    expectedTransactionHash: attempt.expectedTransactionHash as `0x${string}`,
    broadcastAttemptId: attempt.attemptId,
    broadcastStatus: attempt.status,
    fromDurableEvidence,
  } as const;
  if (attempt.status !== "ACCEPTED")
    return { ok: false, code: "BROADCAST_NOT_ACCEPTED", ...common };
  return {
    ok: true,
    ...common,
    broadcastStatus: "ACCEPTED",
    rematerializedBeforeSend,
    authorization: authorize(
      safeResultPayload(ids, attempt.expectedTransactionHash as `0x${string}`),
    ),
  };
};

/**
 * Same-child local execution composition. The signer callback hands raw bytes
 * directly to this call stack; no parent-facing type or persistence layer
 * contains them. The accepted broadcaster remains the only send state machine.
 */
export const executeAuthorizedTransferCore = async (
  deps: ExecuteAuthorizedTransferDeps,
  requestInput: unknown,
): Promise<ExecuteAuthorizedTransferOutcome> => {
  const parsed = authorizedTransferRequestSchema.safeParse(requestInput);
  if (!parsed.success) return { ok: false, code: "INVALID_REQUEST" };
  const ids = parsed.data;

  return deps.executionStore.withExecutionLock(ids.operationId, async () => {
    const existingAttempt = await deps.executionStore.findBroadcastAttempt(ids);
    if (existingAttempt) {
      return lifecycleResult(
        ids,
        existingAttempt,
        true,
        false,
        deps.authorizeResult,
      );
    }

    const durableEvidence = await deps.store.findDurableSignedEvidence(ids);
    let material:
      | {
          signedTransactionId: string;
          expectedTransactionHash: `0x${string}`;
          rawTransaction?: string;
          fromDurableEvidence: boolean;
        }
      | undefined;
    const signerOutcome = await signAuthorizedTransferCore(deps, ids, {
      rematerializeExistingEvidence: durableEvidence !== null,
      onSignedMaterial: (value) => {
        material = value;
      },
    });
    if (!signerOutcome.ok) return signerOutcome;
    if (!material?.rawTransaction) return { ok: false, code: "INTERNAL" };

    let derivedHash: `0x${string}`;
    try {
      derivedHash = canonicalSignedTransactionHash(
        material.rawTransaction,
      ) as `0x${string}`;
    } catch {
      return { ok: false, code: "INTERNAL" };
    }
    if (
      derivedHash !== signerOutcome.transactionHash ||
      (durableEvidence !== null &&
        derivedHash !== durableEvidence.transactionHash)
    )
      return { ok: false, code: "INTERNAL" };

    const attemptId = material.signedTransactionId.replace(
      /^signed:/,
      "attempt:",
    );
    const broadcast = await broadcastSignedTransaction(
      {
        ...deps.broadcastStore,
        startBroadcastAttempt: async (...args) => {
          const started = await deps.broadcastStore.startBroadcastAttempt(
            ...args,
          );
          if (started.status === "STARTED") deps.onPhase?.("broadcast-started");
          return started;
        },
      },
      deps.sender,
      {
        request: ids,
        signedTransactionId: material.signedTransactionId,
        attemptId,
        rawTransaction: material.rawTransaction,
      },
    );
    const attemptResult = lifecycleResult(
      ids,
      broadcast.attempt,
      material.fromDurableEvidence,
      material.fromDurableEvidence,
      deps.authorizeResult,
    );
    return attemptResult;
  });
};
