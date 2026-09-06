import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  broadcastSignedTransaction,
  ProvenPreAcceptanceRejection,
  type BroadcastAttempt,
  type BroadcastStore,
  type DurableSignedTransaction,
} from "../src/index.js";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const otherAccount = privateKeyToAccount(`0x${"2".repeat(64)}`);
const rawTransaction = await account.signTransaction({
  chainId: 31337,
  type: "eip1559",
  to: `0x${"3".repeat(40)}`,
  value: 0n,
  nonce: 0,
  gas: 21_000n,
  maxFeePerGas: 2n,
  maxPriorityFeePerGas: 1n,
  data: "0x",
  accessList: [],
});
const unrelatedRawTransaction = await otherAccount.signTransaction({
  chainId: 31337,
  type: "eip1559",
  to: `0x${"3".repeat(40)}`,
  value: 0n,
  nonce: 0,
  gas: 21_000n,
  maxFeePerGas: 2n,
  maxPriorityFeePerGas: 1n,
  data: "0x",
  accessList: [],
});
const hash = keccak256(rawTransaction);
const signed: DurableSignedTransaction = {
  signedTransactionId: "signed:operation_1:1",
  operationId: "operation_1",
  reservationId: "reservation_1",
  envelopeId: "envelope_1",
  envelopeRevision: 1,
  envelopeHash: `0x${"b".repeat(64)}`,
  authorizationId: "authorization_1",
  fixtureInstanceId: "fixture_1",
  expectedTransactionHash: hash,
};
const request = {
  operationId: signed.operationId,
  authorizationId: signed.authorizationId,
  adapterRequestId: "adapter_request_1",
};

const memoryStore = (existing?: BroadcastAttempt): BroadcastStore => {
  let attempt = existing;
  return {
    findSignedTransaction: async () => signed,
    startBroadcastAttempt: async (value, attemptId) => {
      if (attempt) return attempt;
      attempt = {
        attemptId,
        ...value,
        status: "STARTED",
        responseTransactionHash: null,
        classificationReason: null,
      };
      return attempt;
    },
    finishBroadcastAttempt: async (input) => {
      if (!attempt) throw new Error("missing attempt");
      attempt = { ...attempt, ...input };
      return attempt;
    },
  };
};

const input = {
  request,
  signedTransactionId: signed.signedTransactionId,
  attemptId: "attempt_1",
  rawTransaction,
};

describe("persist-before-send broadcast", () => {
  it("commits STARTED before sending and accepts the matching hash", async () => {
    const events: string[] = [];
    const store = memoryStore();
    const result = await broadcastSignedTransaction(
      {
        ...store,
        startBroadcastAttempt: async (...args) => {
          events.push("STARTED");
          return store.startBroadcastAttempt(...args);
        },
      },
      {
        sendRawTransaction: async (raw) => {
          events.push(`SEND:${raw}`);
          return hash;
        },
      },
      input,
    );
    expect(result.ok).toBe(true);
    expect(result.attempt.status).toBe("ACCEPTED");
    expect(events).toEqual(["STARTED", `SEND:${rawTransaction}`]);
  });

  it("classifies only an explicit local no-send rejection as REJECTED", async () => {
    const result = await broadcastSignedTransaction(
      memoryStore(),
      {
        sendRawTransaction: async () => {
          throw new ProvenPreAcceptanceRejection();
        },
      },
      input,
    );
    expect(result).toMatchObject({
      ok: false,
      attempt: {
        status: "REJECTED",
        classificationReason: "RPC_REQUEST_NOT_TRANSMITTED",
      },
    });
  });

  it("keeps an RPC stale-nonce response UNKNOWN because prior acceptance is possible", async () => {
    const result = await broadcastSignedTransaction(
      memoryStore(),
      {
        sendRawTransaction: async () => {
          throw new Error("nonce too low");
        },
      },
      input,
    );
    expect(result).toMatchObject({ ok: false, attempt: { status: "UNKNOWN" } });
  });

  it.each([
    ["timeout", new Error("timeout")],
    ["connection loss", new Error("connection lost")],
  ])("keeps %s UNKNOWN", async (_label, error) => {
    const result = await broadcastSignedTransaction(
      memoryStore(),
      {
        sendRawTransaction: async () => {
          throw error;
        },
      },
      input,
    );
    expect(result).toMatchObject({ ok: false, attempt: { status: "UNKNOWN" } });
  });

  it("classifies a contradictory returned hash as CONFLICT", async () => {
    const result = await broadcastSignedTransaction(
      memoryStore(),
      { sendRawTransaction: async () => `0x${"c".repeat(64)}` },
      input,
    );
    expect(result).toMatchObject({
      ok: false,
      attempt: {
        status: "CONFLICT",
        classificationReason: "CONTRADICTORY_RETURNED_HASH",
      },
    });
  });

  it.each([
    [
      "one-byte mutation",
      `${rawTransaction.slice(0, -2)}${rawTransaction.endsWith("00") ? "01" : "00"}`,
    ],
    ["unrelated valid signed transaction", unrelatedRawTransaction],
    ["malformed signed bytes", "0xdeadbeef"],
  ])("rejects %s before persistence or send", async (_label, raw) => {
    let starts = 0;
    let sends = 0;
    const store = memoryStore();
    await expect(
      broadcastSignedTransaction(
        {
          ...store,
          startBroadcastAttempt: async (...args) => {
            starts += 1;
            return store.startBroadcastAttempt(...args);
          },
        },
        {
          sendRawTransaction: async () => {
            sends += 1;
            return hash;
          },
        },
        { ...input, rawTransaction: raw },
      ),
    ).rejects.toThrow(/signed transaction|expected transaction hash/i);
    expect(starts).toBe(0);
    expect(sends).toBe(0);
  });

  it("never includes raw signed bytes in validation errors", async () => {
    const malformed = "0xdeadbeef";
    await expect(
      broadcastSignedTransaction(
        memoryStore(),
        { sendRawTransaction: async () => hash },
        {
          ...input,
          rawTransaction: malformed,
        },
      ),
    ).rejects.not.toThrow(malformed);
  });

  it("does not send again when the durable attempt is already terminal", async () => {
    const terminal: BroadcastAttempt = {
      attemptId: input.attemptId,
      ...signed,
      status: "UNKNOWN",
      responseTransactionHash: null,
      classificationReason: "TRANSPORT_OR_RESPONSE_UNCERTAIN",
    };
    let sends = 0;
    const result = await broadcastSignedTransaction(
      memoryStore(terminal),
      {
        sendRawTransaction: async () => {
          sends += 1;
          return hash;
        },
      },
      input,
    );
    expect(result.ok).toBe(false);
    expect(sends).toBe(0);
  });

  it("rejects a request bound to another operation before persistence or send", async () => {
    await expect(
      broadcastSignedTransaction(
        memoryStore(),
        { sendRawTransaction: async () => hash },
        {
          ...input,
          request: { ...request, operationId: "operation_2" },
        },
      ),
    ).rejects.toThrow("operation binding mismatch");
  });
});
