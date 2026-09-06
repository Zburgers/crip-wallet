import {
  authorizedTransferRequestSchema,
  type SignAuthorizedTransferRequest,
} from "@crip/adapter-sdk";
import { keccak256, parseTransaction, serializeTransaction } from "viem";

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const RAW_TRANSACTION_PATTERN = /^0x[0-9a-f]+$/;

export type BroadcastAttemptStatus =
  "STARTED" | "ACCEPTED" | "REJECTED" | "UNKNOWN" | "CONFLICT";

export interface DurableSignedTransaction {
  signedTransactionId: string;
  operationId: string;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: string;
  authorizationId: string;
  fixtureInstanceId: string;
  expectedTransactionHash: string;
}

export interface BroadcastAttempt {
  attemptId: string;
  signedTransactionId: string;
  operationId: string;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: string;
  authorizationId: string;
  fixtureInstanceId: string;
  expectedTransactionHash: string;
  status: BroadcastAttemptStatus;
  responseTransactionHash: string | null;
  classificationReason: string | null;
}

export interface BroadcastStore {
  findSignedTransaction(
    signedTransactionId: string,
  ): Promise<DurableSignedTransaction | null>;
  /** Commits STARTED before this method resolves. */
  startBroadcastAttempt(
    signed: DurableSignedTransaction,
    attemptId: string,
  ): Promise<BroadcastAttempt>;
  finishBroadcastAttempt(input: {
    attemptId: string;
    status: Exclude<BroadcastAttemptStatus, "STARTED">;
    responseTransactionHash: string | null;
    classificationReason: string;
  }): Promise<BroadcastAttempt>;
}

export interface RawTransactionSender {
  /** Raw bytes remain inside the signer/broadcast boundary. */
  sendRawTransaction(rawTransaction: string): Promise<string>;
}

export class ProvenPreAcceptanceRejection extends Error {
  readonly preAcceptance = true;

  constructor() {
    super("RPC_REQUEST_NOT_TRANSMITTED");
    this.name = "ProvenPreAcceptanceRejection";
  }
}

export interface BroadcastInput {
  request: SignAuthorizedTransferRequest;
  signedTransactionId: string;
  attemptId: string;
  /** Supplied only across the private signer/broadcast boundary. */
  rawTransaction: string;
}

export interface BroadcastSuccess {
  ok: true;
  attempt: BroadcastAttempt;
}
export interface BroadcastFailure {
  ok: false;
  attempt: BroadcastAttempt;
}
export type BroadcastResult = BroadcastSuccess | BroadcastFailure;

const validIdentifier = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

const assertSafeInput = (input: BroadcastInput): void => {
  authorizedTransferRequestSchema.parse(input.request);
  if (!validIdentifier(input.signedTransactionId))
    throw new Error("invalid signed transaction identity");
  if (!validIdentifier(input.attemptId))
    throw new Error("invalid broadcast attempt identity");
  if (!RAW_TRANSACTION_PATTERN.test(input.rawTransaction))
    throw new Error("invalid raw transaction encoding");
};

export const canonicalSignedTransactionHash = (
  rawTransaction: string,
): string => {
  try {
    const raw = rawTransaction as `0x${string}`;
    const parsed = parseTransaction(raw);
    if (
      parsed.type !== "eip1559" ||
      parsed.r === undefined ||
      parsed.s === undefined ||
      parsed.yParity === undefined ||
      serializeTransaction(parsed) !== raw
    )
      throw new Error("non-canonical or unsigned transaction");
    return keccak256(raw);
  } catch {
    throw new Error("invalid canonical signed transaction encoding");
  }
};

/** Persist-before-send broadcast state machine. It never signs or reconstructs a transaction. */
export const broadcastSignedTransaction = async (
  store: BroadcastStore,
  sender: RawTransactionSender,
  input: BroadcastInput,
): Promise<BroadcastResult> => {
  assertSafeInput(input);
  const signed = await store.findSignedTransaction(input.signedTransactionId);
  if (!signed) throw new Error("durable signed evidence not found");
  if (signed.operationId !== input.request.operationId)
    throw new Error("signed evidence operation binding mismatch");
  if (signed.authorizationId !== input.request.authorizationId)
    throw new Error("signed evidence authorization binding mismatch");
  const derivedTransactionHash = canonicalSignedTransactionHash(
    input.rawTransaction,
  );
  if (derivedTransactionHash !== signed.expectedTransactionHash)
    throw new Error("signed bytes do not match expected transaction hash");

  const started = await store.startBroadcastAttempt(signed, input.attemptId);
  if (
    started.signedTransactionId !== signed.signedTransactionId ||
    started.expectedTransactionHash !== signed.expectedTransactionHash ||
    started.operationId !== signed.operationId ||
    started.authorizationId !== signed.authorizationId
  )
    throw new Error("broadcast attempt binding mismatch");
  if (started.status !== "STARTED") {
    return started.status === "ACCEPTED"
      ? { ok: true, attempt: started }
      : { ok: false, attempt: started };
  }

  let status: Exclude<BroadcastAttemptStatus, "STARTED"> = "UNKNOWN";
  let responseTransactionHash: string | null = null;
  let classificationReason = "TRANSPORT_OR_RESPONSE_UNCERTAIN";
  try {
    const response = await sender.sendRawTransaction(input.rawTransaction);
    if (
      HASH_PATTERN.test(response) &&
      response === signed.expectedTransactionHash
    ) {
      status = "ACCEPTED";
      responseTransactionHash = response;
      classificationReason = "MATCHING_RETURNED_TRANSACTION_HASH";
    } else if (HASH_PATTERN.test(response)) {
      status = "CONFLICT";
      responseTransactionHash = response;
      classificationReason = "CONTRADICTORY_RETURNED_HASH";
    } else {
      classificationReason = "INVALID_RETURNED_HASH_UNCERTAIN";
    }
  } catch (error) {
    if (error instanceof ProvenPreAcceptanceRejection) {
      status = "REJECTED";
      classificationReason = error.message;
    }
  }

  const completed = await store.finishBroadcastAttempt({
    attemptId: started.attemptId,
    status,
    responseTransactionHash,
    classificationReason,
  });
  return status === "ACCEPTED"
    ? { ok: true, attempt: completed }
    : { ok: false, attempt: completed };
};
