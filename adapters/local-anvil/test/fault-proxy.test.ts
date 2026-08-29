import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  createFaultProxy,
  type FaultProxy,
  type FaultProxyMode,
} from "../src/fault-proxy.js";

const TX_HASH = "0x" + "ab".repeat(32);
const RAW_TRANSACTION = "0x02" + "cd".repeat(96);
const OTHER_HASH = "0x" + "ef".repeat(32);
const PROXY_WRONG_HASH = "0x" + "00".repeat(31) + "01";

interface UpstreamHarness {
  server: Server;
  url: string;
  calls: Array<{ method: string; body: string }>;
  close: () => Promise<void>;
}

const startUpstream = async (
  result: unknown,
  onRequest?: (method: string) => void,
): Promise<UpstreamHarness> => {
  const calls: Array<{ method: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(body) as { id: number; method: string };
      calls.push({ method: parsed.method, body });
      onRequest?.(parsed.method);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};

const rpc = async (url: string, method: string, params: unknown[] = []) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

describe("local Anvil fault proxy", () => {
  const resources: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(resources.splice(0).map((resource) => resource.close()));
  });

  const proxyFor = async (
    mode: FaultProxyMode = "passthrough",
    result: unknown = TX_HASH,
    options: Omit<Parameters<typeof createFaultProxy>[0], "upstreamUrl"> = {},
  ): Promise<{ proxy: FaultProxy; upstream: UpstreamHarness }> => {
    const upstream = await startUpstream(result);
    resources.push(upstream);
    const proxy = await createFaultProxy({
      upstreamUrl: upstream.url,
      mode,
      ...options,
    });
    resources.push(proxy);
    return { proxy, upstream };
  };

  it.each([
    "http://203.0.113.10:8545",
    "http://localhost:8545",
    "https://127.0.0.1:8545",
    "http://user:pass@127.0.0.1:8545",
  ])("rejects an unsafe upstream URL: %s", async (upstreamUrl) => {
    await expect(createFaultProxy({ upstreamUrl })).rejects.toThrow(
      /loopback-only|local Anvil/i,
    );
  });

  it("does not send unavailable-before-send requests upstream", async () => {
    const { proxy, upstream } = await proxyFor("unavailable-before-send");

    await expect(
      rpc(proxy.url, "eth_sendRawTransaction", [RAW_TRANSACTION]),
    ).rejects.toThrow();
    expect(upstream.calls).toHaveLength(0);
    expect(proxy.requestCount("eth_sendRawTransaction")).toBe(1);
    expect(proxy.forwardCount("eth_sendRawTransaction")).toBe(0);
  });

  it("fails closed when the loopback upstream is not Anvil 31337", async () => {
    const { proxy, upstream } = await proxyFor("passthrough", "0x1");

    const response = await rpc(proxy.url, "eth_chainId");
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "refusing non-31337 upstream chain" },
    });
    expect(upstream.calls).toHaveLength(1);
  });

  it("returns a deterministic explicit rejection without forwarding", async () => {
    const { proxy, upstream } = await proxyFor("explicit-rpc-rejection");

    const first = await rpc(proxy.url, "eth_sendRawTransaction", [
      RAW_TRANSACTION,
    ]);
    const second = await rpc(proxy.url, "eth_sendRawTransaction", [
      RAW_TRANSACTION,
    ]);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "deterministic RPC rejection" },
    });
    expect(secondBody).toEqual(firstBody);
    expect(upstream.calls).toHaveLength(0);
  });

  it("forwards exactly once, then drops the response", async () => {
    const { proxy, upstream } = await proxyFor("forward-then-drop");

    await expect(
      rpc(proxy.url, "eth_sendRawTransaction", [RAW_TRANSACTION]),
    ).rejects.toThrow();
    expect(upstream.calls).toHaveLength(1);
    expect(proxy.forwardCount("eth_sendRawTransaction")).toBe(1);
  });

  it.each<[FaultProxyMode, string, unknown, string]>([
    ["wrong-transaction-hash", "eth_sendRawTransaction", TX_HASH, OTHER_HASH],
    [
      "mutated-transaction",
      "eth_getTransactionByHash",
      { hash: TX_HASH, from: "0x1111111111111111111111111111111111111111" },
      "0x0000000000000000000000000000000000000000",
    ],
    [
      "mutated-receipt",
      "eth_getTransactionReceipt",
      { transactionHash: TX_HASH, status: "0x1" },
      "0x0",
    ],
  ])(
    "applies %s deterministically to its RPC method",
    async (mode, method, result, expected) => {
      const { proxy } = await proxyFor(mode, result);
      const params =
        method === "eth_sendRawTransaction" ? [RAW_TRANSACTION] : [TX_HASH];

      const first = await (await rpc(proxy.url, method, params)).json();
      const second = await (await rpc(proxy.url, method, params)).json();
      expect(first).toEqual(second);
      if (mode === "wrong-transaction-hash")
        expect(first.result).toBe(PROXY_WRONG_HASH);
      if (mode === "mutated-transaction")
        expect(first.result.from).toBe(expected);
      if (mode === "mutated-receipt")
        expect(first.result.status).toBe(expected);
    },
  );

  it("withholds receipts until the explicit barrier is released", async () => {
    const { proxy, upstream } = await proxyFor("withhold-receipt");
    const responsePromise = rpc(proxy.url, "eth_getTransactionReceipt", [
      TX_HASH,
    ]);
    await proxy.waitForForward("eth_getTransactionReceipt");
    expect(proxy.forwardCount("eth_getTransactionReceipt")).toBe(1);
    let settled = false;
    void responsePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    proxy.releaseReceipt();
    await expect((await responsePromise).json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: TX_HASH,
    });
    expect(upstream.calls).toHaveLength(1);
  });

  it("simulates crash-before-send without forwarding", async () => {
    const { proxy, upstream } = await proxyFor("crash-before-send");

    await expect(
      rpc(proxy.url, "eth_sendRawTransaction", [RAW_TRANSACTION]),
    ).rejects.toThrow();
    expect(upstream.calls).toHaveLength(0);
    expect(proxy.crashed).toBe(true);
  });

  it("simulates crash-after-forward with one upstream request", async () => {
    const { proxy, upstream } = await proxyFor("crash-after-forward");

    await expect(
      rpc(proxy.url, "eth_sendRawTransaction", [RAW_TRANSACTION]),
    ).rejects.toThrow();
    expect(upstream.calls).toHaveLength(1);
    expect(proxy.crashed).toBe(true);
  });

  it("redacts raw transaction bytes from request inspection", async () => {
    const { proxy } = await proxyFor("passthrough");

    await (
      await rpc(proxy.url, "eth_sendRawTransaction", [RAW_TRANSACTION])
    ).json();
    const snapshot = JSON.stringify(proxy.requests());
    expect(snapshot).not.toContain(RAW_TRANSACTION);
    expect(snapshot).toContain("REDACTED");
  });

  it("supports method-scoped mode control and reliable cleanup", async () => {
    const { proxy, upstream } = await proxyFor("passthrough");
    proxy.setMode("explicit-rpc-rejection", {
      method: "eth_sendRawTransaction",
    });

    const response = await rpc(proxy.url, "eth_sendRawTransaction", [
      RAW_TRANSACTION,
    ]);
    expect(response.status).toBe(200);
    expect(upstream.calls).toHaveLength(0);
    expect(proxy.requestCount()).toBe(1);

    await proxy.close();
    await expect(rpc(proxy.url, "eth_chainId")).rejects.toThrow();
  });
});
