import { createServer, type Server } from "node:http";

import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import {
  broadcastSignedTransaction,
  createFaultProxy,
  ProvenPreAcceptanceRejection,
  type BroadcastAttempt,
  type BroadcastStore,
  type DurableSignedTransaction,
  type FaultProxy,
} from "../src/index.js";

const rawTransaction = await privateKeyToAccount(
  `0x${"1".repeat(64)}`,
).signTransaction({
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
const expectedHash = keccak256(rawTransaction);
const signed: DurableSignedTransaction = {
  signedTransactionId: "signed:p206b:unit",
  operationId: "op_p206b_unit",
  reservationId: "res_p206b_unit",
  envelopeId: "env_p206b_unit",
  envelopeRevision: 1,
  envelopeHash: `0x${"b".repeat(64)}`,
  authorizationId: "auth_p206b_unit",
  fixtureInstanceId: "fixture_p206b_unit",
  expectedTransactionHash: expectedHash,
};
const request = {
  operationId: signed.operationId,
  authorizationId: signed.authorizationId,
  adapterRequestId: "request_p206b_unit",
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

const startUpstream = async (
  result: string,
): Promise<{ server: Server; url: string }> => {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number };
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("upstream did not bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const senderFor = (proxy: FaultProxy, preAcceptanceRejection = false) => ({
  sendRawTransaction: async (raw: string): Promise<string> => {
    const response = await fetch(proxy.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [raw],
      }),
    });
    const body = (await response.json()) as {
      result?: string;
      error?: { message?: string };
    };
    if (body.error) {
      if (preAcceptanceRejection) throw new ProvenPreAcceptanceRejection();
      throw new Error(body.error.message ?? "RPC error");
    }
    if (!body.result) throw new Error("RPC response unavailable");
    return body.result;
  },
});

describe("P2-06B broadcaster classification using the accepted fault proxy", () => {
  const resources: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(resources.splice(0).map((resource) => resource.close()));
  });

  it.each([
    ["unavailable-before-send", "UNKNOWN", 0],
    ["forward-then-drop", "UNKNOWN", 1],
    ["wrong-transaction-hash", "CONFLICT", 1],
    ["crash-before-send", "UNKNOWN", 0],
    ["crash-after-forward", "UNKNOWN", 1],
  ] as const)(
    "classifies %s as %s with exact proxy counts",
    async (mode, status, forwards) => {
      const upstream = await startUpstream(expectedHash);
      resources.push({
        close: () =>
          new Promise<void>((resolve, reject) =>
            upstream.server.close((error) =>
              error ? reject(error) : resolve(),
            ),
          ),
      });
      const proxy = await createFaultProxy({ upstreamUrl: upstream.url, mode });
      resources.push(proxy);
      const result = await broadcastSignedTransaction(
        memoryStore(),
        senderFor(proxy),
        {
          request,
          signedTransactionId: signed.signedTransactionId,
          attemptId: "attempt:p206b:unit",
          rawTransaction,
        },
      );
      expect(result.attempt.status).toBe(status);
      expect(result.attempt.expectedTransactionHash).toBe(expectedHash);
      expect(proxy.requestCount("eth_sendRawTransaction")).toBe(1);
      expect(proxy.forwardCount("eth_sendRawTransaction")).toBe(forwards);
    },
  );

  it("classifies explicit proven non-transmission as REJECTED", async () => {
    const upstream = await startUpstream(expectedHash);
    resources.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.server.close((error) => (error ? reject(error) : resolve())),
        ),
    });
    const proxy = await createFaultProxy({
      upstreamUrl: upstream.url,
      mode: "explicit-rpc-rejection",
    });
    resources.push(proxy);
    const result = await broadcastSignedTransaction(
      memoryStore(),
      senderFor(proxy, true),
      {
        request,
        signedTransactionId: signed.signedTransactionId,
        attemptId: "attempt:p206b:rejected",
        rawTransaction,
      },
    );
    expect(result.attempt.status).toBe("REJECTED");
    expect(proxy.requestCount("eth_sendRawTransaction")).toBe(1);
    expect(proxy.forwardCount("eth_sendRawTransaction")).toBe(0);
  });

  it.each(["ACCEPTED", "UNKNOWN", "CONFLICT", "REJECTED"] as const)(
    "%s durable attempt forbids automatic re-sign and same-execution retry",
    async (status) => {
      const existing: BroadcastAttempt = {
        attemptId: "attempt:p206b:existing",
        ...signed,
        status,
        responseTransactionHash:
          status === "CONFLICT" ? `0x${"c".repeat(64)}` : null,
        classificationReason: "test-state",
      };
      const signs = 0;
      let sends = 0;
      const result = await broadcastSignedTransaction(
        memoryStore(existing),
        {
          sendRawTransaction: async () => {
            sends += 1;
            return expectedHash;
          },
        },
        {
          request,
          signedTransactionId: signed.signedTransactionId,
          attemptId: existing.attemptId,
          rawTransaction,
        },
      );
      expect(result.attempt.status).toBe(status);
      expect(sends).toBe(0);
      expect(signs).toBe(0);
    },
  );
});
