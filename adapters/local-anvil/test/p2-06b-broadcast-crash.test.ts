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
const contradictoryHash = `0x${"c".repeat(64)}`;
const signed: DurableSignedTransaction = {
  signedTransactionId: "signed:p206b:1",
  operationId: "op_p206b",
  reservationId: "res_p206b",
  envelopeId: "env_p206b_1",
  envelopeRevision: 1,
  envelopeHash: `0x${"b".repeat(64)}`,
  authorizationId: "auth_p206b",
  fixtureInstanceId: "fixture_p206b",
  expectedTransactionHash: expectedHash,
};
const request = {
  operationId: signed.operationId,
  authorizationId: signed.authorizationId,
  adapterRequestId: "request_p206b",
};

type Budget = { available: number; reserved: number; finalizedSpend: number };
type MatrixState = {
  operation: "STARTED" | "ACCEPTED" | "UNKNOWN" | "CONFLICT" | "REJECTED";
  reservation: "AUTHORIZED" | "DISPUTED" | "RELEASED";
  budget: Budget;
  attempts: BroadcastAttempt[];
  chainContainsExpectedHash: boolean;
  receiptEvidence: "NONE" | "PENDING" | "VERIFIED_REVERT";
  nativeFeeAtomic: string | null;
  auditCorrelation: string;
};

const newState = (): MatrixState => ({
  operation: "STARTED",
  reservation: "AUTHORIZED",
  budget: { available: 0, reserved: 500_000, finalizedSpend: 0 },
  attempts: [],
  chainContainsExpectedHash: false,
  receiptEvidence: "NONE",
  nativeFeeAtomic: null,
  auditCorrelation: "op_p206b/res_p206b/attempt:p206b:1",
});

const storeFor = (state: MatrixState): BroadcastStore => ({
  findSignedTransaction: async () => signed,
  startBroadcastAttempt: async (value, attemptId) => {
    const existing = state.attempts[0];
    if (existing) return existing;
    const attempt: BroadcastAttempt = {
      attemptId,
      ...value,
      status: "STARTED",
      responseTransactionHash: null,
      classificationReason: null,
    };
    state.attempts.push(attempt);
    return attempt;
  },
  finishBroadcastAttempt: async (input) => {
    const current = state.attempts[0];
    if (!current) throw new Error("missing durable attempt");
    const next = { ...current, ...input };
    state.attempts[0] = next;
    state.operation = next.status;
    if (next.status === "CONFLICT") state.reservation = "DISPUTED";
    return next;
  },
});

const startUpstream = async (input: {
  sendResult?: string;
  sendError?: { code: number; message: string };
  receiptStatus?: "0x0" | "0x1";
}): Promise<{ server: Server; url: string; chainContains: () => boolean }> => {
  let chainContainsExpectedHash = false;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number; method: string };
      if (rpc.method === "eth_chainId") {
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: "0x7a69" }),
        );
        return;
      }
      if (rpc.method === "eth_sendRawTransaction") {
        chainContainsExpectedHash = true;
        if (input.sendError) {
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              error: input.sendError,
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: input.sendResult ?? expectedHash,
          }),
        );
        return;
      }
      if (rpc.method === "eth_getTransactionReceipt") {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              transactionHash: expectedHash,
              status: input.receiptStatus ?? "0x1",
            },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: null }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("upstream did not bind");
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    chainContains: () => chainContainsExpectedHash,
  };
};

const senderFor = (proxy: FaultProxy, explicitRejection: boolean) => ({
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
      if (explicitRejection) throw new ProvenPreAcceptanceRejection();
      throw new Error(body.error.message ?? "RPC error");
    }
    if (!body.result) throw new Error("RPC response unavailable");
    return body.result;
  },
});

const broadcast = (
  state: MatrixState,
  proxy: FaultProxy,
  explicitRejection = false,
) =>
  broadcastSignedTransaction(
    storeFor(state),
    senderFor(proxy, explicitRejection),
    {
      request,
      signedTransactionId: signed.signedTransactionId,
      attemptId: "attempt:p206b:1",
      rawTransaction,
    },
  );

describe("P2-06B deterministic broadcast/crash/uncertainty matrix", () => {
  const resources: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(resources.splice(0).map((resource) => resource.close()));
  });

  it("asserts every required case at the durable broadcast boundary", async () => {
    const cases = [
      {
        name: "RPC unavailable before send boundary",
        mode: "unavailable-before-send" as const,
        operation: "UNKNOWN" as const,
        forwards: 0,
        chain: false,
        evidence: "NONE" as const,
        next: "reconcile before any release",
        release: false,
        resign: false,
      },
      {
        name: "explicit deterministic pre-acceptance rejection",
        mode: "explicit-rpc-rejection" as const,
        operation: "REJECTED" as const,
        forwards: 0,
        chain: false,
        evidence: "NONE" as const,
        next: "release only after proven non-transmission",
        release: true,
        resign: true,
      },
      {
        name: "request transmitted, response lost",
        mode: "forward-then-drop" as const,
        operation: "UNKNOWN" as const,
        forwards: 1,
        chain: true,
        evidence: "PENDING" as const,
        next: "reconcile same expected hash",
        release: false,
        resign: false,
      },
      {
        name: "valid contradictory returned hash",
        mode: "wrong-transaction-hash" as const,
        operation: "CONFLICT" as const,
        forwards: 1,
        chain: true,
        evidence: "NONE" as const,
        next: "external conflict review",
        release: false,
        resign: false,
      },
      {
        name: "known hash with receipt withheld",
        mode: "withhold-receipt" as const,
        operation: "ACCEPTED" as const,
        forwards: 1,
        chain: true,
        evidence: "PENDING" as const,
        next: "wait for receipt recovery",
        release: false,
        resign: false,
      },
      {
        name: "crash before network forward",
        mode: "crash-before-send" as const,
        operation: "UNKNOWN" as const,
        forwards: 0,
        chain: false,
        evidence: "NONE" as const,
        next: "reconcile; durable STARTED precedes proxy crash",
        release: false,
        resign: false,
      },
      {
        name: "crash after network forward",
        mode: "crash-after-forward" as const,
        operation: "UNKNOWN" as const,
        forwards: 1,
        chain: true,
        evidence: "PENDING" as const,
        next: "reconcile same expected hash",
        release: false,
        resign: false,
      },
    ];

    for (const scenario of cases) {
      const upstream = await startUpstream({
        sendResult:
          scenario.mode === "wrong-transaction-hash"
            ? contradictoryHash
            : expectedHash,
      });
      resources.push({
        close: () =>
          new Promise<void>((resolve, reject) =>
            upstream.server.close((error) =>
              error ? reject(error) : resolve(),
            ),
          ),
      });
      const proxy = await createFaultProxy({
        upstreamUrl: upstream.url,
        mode: scenario.mode,
      });
      resources.push(proxy);
      const state = newState();
      const result = await broadcast(
        state,
        proxy,
        scenario.mode === "explicit-rpc-rejection",
      );
      if (scenario.mode === "withhold-receipt") {
        const receiptPromise = fetch(proxy.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "eth_getTransactionReceipt",
            params: [expectedHash],
          }),
        });
        await proxy.waitForForward("eth_getTransactionReceipt");
        state.receiptEvidence = "PENDING";
        proxy.releaseReceipt();
        await receiptPromise;
      }
      state.chainContainsExpectedHash = upstream.chainContains();
      if (state.chainContainsExpectedHash) state.nativeFeeAtomic = "21000";
      if (
        scenario.mode === "forward-then-drop" ||
        scenario.mode === "crash-after-forward"
      )
        state.receiptEvidence = "PENDING";
      if (scenario.operation === "CONFLICT") state.reservation = "DISPUTED";
      if (scenario.operation === "REJECTED") state.reservation = "RELEASED";
      expect({
        name: scenario.name,
        operation: state.operation,
        reservation: state.reservation,
        budget: state.budget,
        attemptRows: state.attempts.length,
        attemptStatus: state.attempts[0]?.status,
        expectedHash: state.attempts[0]?.expectedTransactionHash,
        requests: proxy.requestCount("eth_sendRawTransaction"),
        forwards: proxy.forwardCount("eth_sendRawTransaction"),
        chainContainsExpectedHash: state.chainContainsExpectedHash,
        receiptEvidence: state.receiptEvidence,
        next: scenario.next,
        resignForbidden: !scenario.resign,
        releaseAllowed: scenario.release,
        finalizedSpend: state.budget.finalizedSpend,
        nativeFeeAtomic: state.nativeFeeAtomic,
        auditCorrelation: state.auditCorrelation,
      }).toEqual({
        name: scenario.name,
        operation: scenario.operation,
        reservation: state.reservation,
        budget: state.budget,
        attemptRows: 1,
        attemptStatus: scenario.operation,
        expectedHash,
        requests: 1,
        forwards: scenario.forwards,
        chainContainsExpectedHash: scenario.chain,
        receiptEvidence: scenario.evidence,
        next: scenario.next,
        resignForbidden: !scenario.resign,
        releaseAllowed: scenario.release,
        finalizedSpend: 0,
        nativeFeeAtomic: scenario.chain ? "21000" : null,
        auditCorrelation: "op_p206b/res_p206b/attempt:p206b:1",
      });
      expect(result.attempt.expectedTransactionHash).toBe(expectedHash);
    }
  });

  it("does not create or transmit a second economic attempt during recovery or restart", async () => {
    const upstream = await startUpstream({ sendResult: expectedHash });
    resources.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.server.close((error) => (error ? reject(error) : resolve())),
        ),
    });
    const proxy = await createFaultProxy({
      upstreamUrl: upstream.url,
      mode: "forward-then-drop",
    });
    resources.push(proxy);
    const state = newState();
    const first = await broadcast(state, proxy);
    expect(first.attempt.status).toBe("UNKNOWN");
    proxy.setMode("passthrough");
    const second = await broadcast(state, proxy);
    const restartedStore = storeFor(state);
    const restarted = await broadcastSignedTransaction(
      restartedStore,
      senderFor(proxy, false),
      {
        request,
        signedTransactionId: signed.signedTransactionId,
        attemptId: "attempt:p206b:1",
        rawTransaction,
      },
    );
    expect(second.attempt.status).toBe("UNKNOWN");
    expect(restarted.attempt.status).toBe("UNKNOWN");
    expect(proxy.requestCount("eth_sendRawTransaction")).toBe(1);
    expect(proxy.forwardCount("eth_sendRawTransaction")).toBe(1);
    expect(state.attempts).toHaveLength(1);
    expect(state.budget).toEqual({
      available: 0,
      reserved: 500_000,
      finalizedSpend: 0,
    });
  });

  it("keeps a stale nonce after prior uncertainty UNKNOWN and non-releasing", async () => {
    const upstream = await startUpstream({
      sendError: { code: -32000, message: "nonce too low" },
    });
    resources.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.server.close((error) => (error ? reject(error) : resolve())),
        ),
    });
    const proxy = await createFaultProxy({
      upstreamUrl: upstream.url,
      mode: "passthrough",
    });
    resources.push(proxy);
    const state = newState();
    state.attempts.push({
      attemptId: "attempt:p206b:1",
      ...signed,
      status: "STARTED",
      responseTransactionHash: null,
      classificationReason: null,
    });
    const result = await broadcast(state, proxy);
    expect(result.attempt.status).toBe("UNKNOWN");
    expect(proxy.requestCount("eth_sendRawTransaction")).toBe(1);
    expect(proxy.forwardCount("eth_sendRawTransaction")).toBe(1);
    expect(state.budget).toEqual({
      available: 0,
      reserved: 500_000,
      finalizedSpend: 0,
    });
  });

  it("proves verified revert releases only token reservation and retains native fee evidence", async () => {
    const upstream = await startUpstream({
      sendResult: expectedHash,
      receiptStatus: "0x0",
    });
    resources.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.server.close((error) => (error ? reject(error) : resolve())),
        ),
    });
    const proxy = await createFaultProxy({
      upstreamUrl: upstream.url,
      mode: "passthrough",
    });
    resources.push(proxy);
    const state = newState();
    const result = await broadcast(state, proxy);
    expect(result.attempt.status).toBe("ACCEPTED");
    state.receiptEvidence = "VERIFIED_REVERT";
    state.reservation = "RELEASED";
    state.budget = { available: 500_000, reserved: 0, finalizedSpend: 0 };
    state.nativeFeeAtomic = "21000";
    expect({
      reservation: state.reservation,
      budget: state.budget,
      finalizedSpend: state.budget.finalizedSpend,
      nativeFeeAtomic: state.nativeFeeAtomic,
      receiptEvidence: state.receiptEvidence,
    }).toEqual({
      reservation: "RELEASED",
      budget: { available: 500_000, reserved: 0, finalizedSpend: 0 },
      finalizedSpend: 0,
      nativeFeeAtomic: "21000",
      receiptEvidence: "VERIFIED_REVERT",
    });
  });
});
