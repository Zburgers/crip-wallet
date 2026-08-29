import { describe, expect, it } from "vitest";

import {
  broadcastSignedTransaction,
  ProvenPreAcceptanceRejection,
  type BroadcastAttempt,
  type BroadcastStore,
  type DurableSignedTransaction,
} from "../src/index.js";

const hash = `0x${"a".repeat(64)}`;
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
  rawTransaction: "0xdeadbeef",
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
    expect(events).toEqual(["STARTED", "SEND:0xdeadbeef"]);
  });

  it("classifies explicit pre-acceptance rejection as REJECTED", async () => {
    const result = await broadcastSignedTransaction(
      memoryStore(),
      {
        sendRawTransaction: async () => {
          throw new ProvenPreAcceptanceRejection("NONCE_TOO_LOW");
        },
      },
      input,
    );
    expect(result).toMatchObject({
      ok: false,
      attempt: { status: "REJECTED", classificationReason: "NONCE_TOO_LOW" },
    });
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

  it("keeps a contradictory returned hash UNKNOWN", async () => {
    const result = await broadcastSignedTransaction(
      memoryStore(),
      { sendRawTransaction: async () => `0x${"c".repeat(64)}` },
      input,
    );
    expect(result).toMatchObject({
      ok: false,
      attempt: {
        status: "UNKNOWN",
        classificationReason: "CONTRADICTORY_OR_INVALID_RETURNED_HASH",
      },
    });
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
