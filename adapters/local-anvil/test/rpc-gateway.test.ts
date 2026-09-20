import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { withChainMutationLease } from "../src/chain-mutation-lease.mjs";
import { startAnvilRpcGateway } from "../src/rpc-gateway.mjs";

const state = JSON.stringify({
  accounts: {},
  best_block_number: "0x0",
  block: {},
  blocks: [],
  historical_states: [],
  transactions: [],
});
const stateBlob = `0x${gzipSync(state).toString("hex")}`;

const startFakeUpstream = async (
  handle: (method: string) => Promise<unknown> | unknown,
) => {
  const calls: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id: unknown;
        method: string;
      };
      calls.push(body.method);
      const result = await handle(body.method);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fake RPC server did not bind a TCP port");
  return {
    calls,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      server.closeAllConnections();
      await closed;
    },
  };
};

const rpc = async (url: string, request: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return { status: response.status, body: await response.json() };
};

describe("Anvil RPC mutation gateway", () => {
  it("lets signer reads through while holding the lease and blocks writes through durable snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "crip-rpc-gateway-"));
    const lockPath = join(directory, "anvil.lock");
    await writeFile(lockPath, "", { mode: 0o600 });
    const snapshotPath = join(directory, "state.json");
    const poisonPath = join(directory, "poisoned");
    let signalMutation!: () => void;
    let signalDump!: () => void;
    let releaseDump!: () => void;
    const mutationStarted = new Promise<void>((resolve) => {
      signalMutation = resolve;
    });
    const dumpStarted = new Promise<void>((resolve) => {
      signalDump = resolve;
    });
    const dumpRelease = new Promise<void>((resolve) => {
      releaseDump = resolve;
    });
    let dumpCount = 0;
    const upstream = await startFakeUpstream(async (method) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "anvil_dumpState") {
        if (++dumpCount === 2) {
          signalDump();
          await dumpRelease;
        }
        return stateBlob;
      }
      if (method === "eth_sendTransaction") signalMutation();
      return true;
    });
    const gateway = await startAnvilRpcGateway({
      upstreamUrl: upstream.url,
      lockPath,
      snapshotPath,
      poisonPath,
    });
    let writePromise: Promise<{ status: number; body: unknown }> | undefined;

    try {
      await withChainMutationLease(lockPath, async () => {
        await expect(
          rpc(gateway.url, {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_chainId",
            params: [],
          }),
        ).resolves.toMatchObject({ body: { result: "0x7a69" } });
        writePromise = rpc(gateway.url, {
          jsonrpc: "2.0",
          id: 2,
          method: "eth_sendTransaction",
          params: [{}],
        });
      });

      await mutationStarted;
      await dumpStarted;
      let writeFinished = false;
      void writePromise?.then(() => {
        writeFinished = true;
      });
      expect(
        spawnSync("flock", ["--exclusive", "--nonblock", lockPath, "true"])
          .status,
      ).not.toBe(0);
      expect(writeFinished).toBe(false);

      releaseDump();
      await expect(writePromise).resolves.toMatchObject({
        body: { result: true },
      });
      expect(
        spawnSync("flock", ["--exclusive", "--nonblock", lockPath, "true"])
          .status,
      ).toBe(0);
      expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toEqual(
        JSON.parse(state),
      );
    } finally {
      releaseDump();
      await Promise.allSettled([...(writePromise ? [writePromise] : [])]);
      await gateway.close();
      await upstream.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("checks recovered state while allowing block and transaction reordering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "crip-rpc-gateway-"));
    const lockPath = join(directory, "anvil.lock");
    const snapshotPath = join(directory, "state.json");
    await writeFile(lockPath, "", { mode: 0o600 });
    const persisted = {
      ...JSON.parse(state),
      blocks: [
        { header: { number: "0x0", timestamp: "0x1" } },
        { header: { number: "0x0", timestamp: "0x2" } },
      ],
      transactions: [
        { block_hash: "0xa", block_number: "0x1", info: { hash: "0x1" } },
        { block_hash: "0xb", block_number: "0x2", info: { hash: "0x2" } },
      ],
    };
    const recovered = {
      ...persisted,
      blocks: [
        persisted.blocks[1],
        { header: { number: "0x0", timestamp: "0x3" } },
        persisted.blocks[0],
      ],
      transactions: [persisted.transactions[1], persisted.transactions[0]],
    };
    await writeFile(snapshotPath, JSON.stringify(persisted), { mode: 0o600 });
    const upstream = await startFakeUpstream((method) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "anvil_dumpState")
        return `0x${gzipSync(JSON.stringify(recovered)).toString("hex")}`;
      return true;
    });
    const gateway = await startAnvilRpcGateway({
      upstreamUrl: upstream.url,
      lockPath,
      snapshotPath,
      poisonPath: join(directory, "poisoned"),
    });

    try {
      expect((await fetch(`${gateway.url}/healthz`)).status).toBe(200);
    } finally {
      await gateway.close();
      await upstream.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects recovered state when retained block history differs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "crip-rpc-gateway-"));
    const lockPath = join(directory, "anvil.lock");
    const snapshotPath = join(directory, "state.json");
    const poisonPath = join(directory, "poisoned");
    await writeFile(lockPath, "", { mode: 0o600 });
    const persisted = {
      ...JSON.parse(state),
      blocks: [
        { header: { number: "0x0", timestamp: "0x1" } },
        { header: { number: "0x0", timestamp: "0x2" } },
      ],
    };
    const recovered = {
      ...persisted,
      blocks: [
        { header: { number: "0x0", timestamp: "0x3" } },
        persisted.blocks[0],
        { header: { number: "0x0", timestamp: "0x4" } },
      ],
    };
    await writeFile(snapshotPath, JSON.stringify(persisted), { mode: 0o600 });
    const upstream = await startFakeUpstream((method) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "anvil_dumpState")
        return `0x${gzipSync(JSON.stringify(recovered)).toString("hex")}`;
      return true;
    });
    const gateway = await startAnvilRpcGateway({
      upstreamUrl: upstream.url,
      lockPath,
      snapshotPath,
      poisonPath,
    });

    try {
      expect((await fetch(`${gateway.url}/healthz`)).status).toBe(503);
      await expect(readFile(poisonPath, "utf8")).resolves.toContain("startup");
    } finally {
      await gateway.close();
      await upstream.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects recovered state when a transaction record changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "crip-rpc-gateway-"));
    const lockPath = join(directory, "anvil.lock");
    const snapshotPath = join(directory, "state.json");
    const poisonPath = join(directory, "poisoned");
    await writeFile(lockPath, "", { mode: 0o600 });
    const persisted = {
      ...JSON.parse(state),
      transactions: [
        { block_hash: "0xa", block_number: "0x1", info: { hash: "0x1" } },
      ],
    };
    const recovered = {
      ...persisted,
      transactions: [
        { block_hash: "0xa", block_number: "0x1", info: { hash: "0x2" } },
      ],
    };
    await writeFile(snapshotPath, JSON.stringify(persisted), { mode: 0o600 });
    const upstream = await startFakeUpstream((method) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "anvil_dumpState")
        return `0x${gzipSync(JSON.stringify(recovered)).toString("hex")}`;
      return true;
    });
    const gateway = await startAnvilRpcGateway({
      upstreamUrl: upstream.url,
      lockPath,
      snapshotPath,
      poisonPath,
    });

    try {
      expect((await fetch(`${gateway.url}/healthz`)).status).toBe(503);
      await expect(readFile(poisonPath, "utf8")).resolves.toContain("startup");
    } finally {
      await gateway.close();
      await upstream.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects interval mining, batches, and other unsupported RPCs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "crip-rpc-gateway-"));
    const lockPath = join(directory, "anvil.lock");
    await writeFile(lockPath, "", { mode: 0o600 });
    const upstream = await startFakeUpstream((method) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "anvil_dumpState") return stateBlob;
      return true;
    });
    const gateway = await startAnvilRpcGateway({
      upstreamUrl: upstream.url,
      lockPath,
      snapshotPath: join(directory, "state.json"),
      poisonPath: join(directory, "poisoned"),
    });

    try {
      const before = [...upstream.calls];
      for (const request of [
        [{ jsonrpc: "2.0", id: 3, method: "anvil_reset", params: [] }],
        { jsonrpc: "2.0", id: 4, method: "not_a_method", params: [] },
        {
          jsonrpc: "2.0",
          id: 12,
          method: "anvil_setIntervalMining",
          params: [1],
        },
        {
          jsonrpc: "2.0",
          id: 13,
          method: "evm_setIntervalMining",
          params: [1],
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "eth_sendUnsignedTransaction",
          params: [{}],
        },
        {
          jsonrpc: "2.0",
          id: 6,
          method: "anvil_reset",
          params: [{ forking: { jsonRpcUrl: "https://example.invalid" } }],
        },
        {
          jsonrpc: "2.0",
          id: 10,
          method: "anvil_setRpcUrl",
          params: ["https://example.invalid"],
        },
        { jsonrpc: "2.0", id: 11, method: "anvil_setChainId", params: [1] },
      ]) {
        const response = await rpc(gateway.url, request);
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("error");
      }
      expect(upstream.calls).toEqual(before);

      await expect(
        rpc(gateway.url, {
          jsonrpc: "2.0",
          id: 7,
          method: "hardhat_setBalance",
          params: ["0x0000000000000000000000000000000000000001", "0x1"],
        }),
      ).resolves.toMatchObject({ body: { result: true } });
      expect(upstream.calls).toContain("hardhat_setBalance");
    } finally {
      await gateway.close();
      await upstream.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("poisons the gateway when a write cannot be snapshotted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "crip-rpc-gateway-"));
    const poisonPath = join(directory, "poisoned");
    await writeFile(join(directory, "anvil.lock"), "", { mode: 0o600 });
    let failSnapshot = false;
    let dumpCount = 0;
    const upstream = await startFakeUpstream((method) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "anvil_dumpState") {
        dumpCount += 1;
        if (failSnapshot && dumpCount > 1) throw new Error("snapshot failed");
        return stateBlob;
      }
      return true;
    });
    const gateway = await startAnvilRpcGateway({
      upstreamUrl: upstream.url,
      lockPath: join(directory, "anvil.lock"),
      snapshotPath: join(directory, "state.json"),
      poisonPath,
    });

    try {
      failSnapshot = true;
      await expect(
        rpc(gateway.url, {
          jsonrpc: "2.0",
          id: 8,
          method: "anvil_setBalance",
          params: ["0x0000000000000000000000000000000000000001", "0x1"],
        }),
      ).resolves.toMatchObject({ body: { error: { code: -32000 } } });
      await expect(readFile(poisonPath, "utf8")).resolves.toContain("snapshot");
      const callsBeforeRead = [...upstream.calls];
      expect((await fetch(`${gateway.url}/healthz`)).status).toBe(503);
      await expect(
        rpc(gateway.url, {
          jsonrpc: "2.0",
          id: 9,
          method: "eth_chainId",
          params: [],
        }),
      ).resolves.toMatchObject({ status: 503 });
      expect(upstream.calls).toEqual(callsBeforeRead);
    } finally {
      await gateway.close();
      await upstream.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
