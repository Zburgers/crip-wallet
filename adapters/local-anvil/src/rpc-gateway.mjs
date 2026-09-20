import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { URL } from "node:url";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { withChainMutationLease } from "./chain-mutation-lease.mjs";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const READ_METHODS = new Set(
  `
    eth_accounts eth_blockNumber eth_call eth_callBundle eth_callMany eth_chainId
    eth_coinbase eth_createAccessList eth_estimateGas eth_feeHistory eth_fillTransaction
    eth_gasPrice eth_getAccountInfo eth_getBalance eth_getBlobByHash
    eth_getBlobsByTransactionHash eth_getBlockAccessList eth_getBlockAccessListByBlockHash
    eth_getBlockAccessListByBlockNumber eth_getBlockAccessListRaw eth_getBlockByHash
    eth_getBlockByNumber eth_getBlockReceipts eth_getBlockTransactionCountByHash
    eth_getBlockTransactionCountByNumber eth_getCode eth_getFilterChanges eth_getFilterLogs
    eth_getHeaderByHash eth_getHeaderByNumber eth_getLogs eth_getProof
    eth_getStorageAt eth_getStorageValues eth_getTransactionByBlockHashAndIndex
    eth_getTransactionByBlockNumberAndIndex eth_getTransactionByHash
    eth_getTransactionBySenderAndNonce eth_getTransactionCount eth_getTransactionReceipt
    eth_maxPriorityFeePerGas eth_pendingTransactions eth_protocolVersion eth_syncing
    anvil_getAutomine hardhat_getAutomine anvil_getIntervalMining hardhat_getIntervalMining
    anvil_getGenesisTime anvil_nodeInfo anvil_metadata hardhat_metadata
    anvil_getBlobByHash anvil_getBlobsByTransactionHash anvil_classifyTransaction
    net_listening net_peerCount net_version web3_clientVersion web3_sha3
  `
    .trim()
    .split(/\s+/),
);
// Foundry's custom method reference lists these state and pool mutations plus their aliases.
const MUTATION_METHODS = new Set(
  `
    eth_sendTransaction eth_sendRawTransaction eth_sendTransactionSync
    eth_sendRawTransactionSync eth_sendRawTransactionConditional eth_resend
    anvil_impersonateAccount hardhat_impersonateAccount
    anvil_stopImpersonatingAccount hardhat_stopImpersonatingAccount
    anvil_autoImpersonateAccount hardhat_autoImpersonateAccount anvil_impersonateSignature
    anvil_setAutomine evm_setAutomine
    anvil_mine hardhat_mine evm_mine anvil_mine_detailed evm_mine_detailed
    anvil_setTime evm_setTime anvil_increaseTime evm_increaseTime
    anvil_setNextBlockTimestamp evm_setNextBlockTimestamp
    anvil_setBlockTimestampInterval anvil_removeBlockTimestampInterval
    anvil_snapshot evm_snapshot anvil_revert evm_revert anvil_reset hardhat_reset
    anvil_reorg anvil_rollback anvil_setBalance hardhat_setBalance tenderly_setBalance
    anvil_addBalance hardhat_addBalance tenderly_addBalance anvil_setCode hardhat_setCode
    anvil_setNonce hardhat_setNonce evm_setAccountNonce anvil_setStorageAt hardhat_setStorageAt
    anvil_dealERC20 anvil_setERC20Balance hardhat_dealERC20 anvil_setERC20Allowance
    anvil_dropTransaction hardhat_dropTransaction anvil_dropAllTransactions
    hardhat_dropAllTransactions anvil_removePoolTransactions
    anvil_setCoinbase hardhat_setCoinbase anvil_setBlockGasLimit evm_setBlockGasLimit
    anvil_setNextBlockBaseFeePerGas hardhat_setNextBlockBaseFeePerGas
    anvil_setMinGasPrice hardhat_setMinGasPrice anvil_setNextBlockPrevRandao
    anvil_setLoggingEnabled hardhat_setLoggingEnabled
  `
    .trim()
    .split(/\s+/),
);

const jsonRpcError = (id, code, message) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const sendJson = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const readBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request body too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const validSnapshot = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  value.accounts !== null &&
  typeof value.accounts === "object" &&
  value.block !== null &&
  typeof value.block === "object" &&
  Array.isArray(value.blocks) &&
  Array.isArray(value.transactions);

// ponytail: exact row matching is O(n²); hash rows if local state grows large.
const unmatchedRestoredRows = (previous, current) => {
  if (current.length < previous.length) return null;
  const unmatched = [...current];
  for (const row of previous) {
    const index = unmatched.findIndex((candidate) =>
      isDeepStrictEqual(row, candidate),
    );
    if (index < 0) return null;
    unmatched.splice(index, 1);
  }
  return unmatched;
};

const restoredBlockHistoryMatches = (previous, current) => {
  if (current.length > previous.length + 1) return false;
  const unmatched = unmatchedRestoredRows(previous, current);
  if (!unmatched) return false;
  if (unmatched.length === 0) return true;
  const [bootBlock] = unmatched;
  return (
    bootBlock !== null &&
    typeof bootBlock === "object" &&
    !Array.isArray(bootBlock) &&
    bootBlock.header !== null &&
    typeof bootBlock.header === "object" &&
    typeof bootBlock.header.number === "string" &&
    typeof bootBlock.header.timestamp === "string"
  );
};

const restoredTransactionsMatch = (previous, current) =>
  previous.length === current.length &&
  unmatchedRestoredRows(previous, current)?.length === 0;

const restoredSnapshotMatches = (previous, current) => {
  const {
    blocks: previousBlocks,
    transactions: previousTransactions,
    ...previousState
  } = previous;
  const {
    blocks: currentBlocks,
    transactions: currentTransactions,
    ...currentState
  } = current;
  return (
    isDeepStrictEqual(previousState, currentState) &&
    restoredBlockHistoryMatches(previousBlocks, currentBlocks) &&
    restoredTransactionsMatch(previousTransactions, currentTransactions)
  );
};

export const startAnvilRpcGateway = async ({
  upstreamUrl,
  lockPath,
  snapshotPath,
  poisonPath,
  host = "127.0.0.1",
  port = 0,
}) => {
  let poisoned = false;
  try {
    await readFile(poisonPath);
    poisoned = true;
  } catch (error) {
    if (error?.code !== "ENOENT") poisoned = true;
  }

  const poison = async (reason) => {
    poisoned = true;
    try {
      await writeFile(poisonPath, `${reason}\n`, { mode: 0o600 });
    } catch {
      // In-memory refusal remains active; dev-up also recreates Anvil under the lease.
    }
  };

  const forward = async (body) => {
    const upstream = await globalThis.fetch(upstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!upstream.ok)
      throw new Error("local Anvil RPC returned a failure status");
    const response = await upstream.json();
    if (
      !response ||
      response.jsonrpc !== "2.0" ||
      !Object.is(response.id, body.id) ||
      !("result" in response || "error" in response)
    )
      throw new Error("local Anvil RPC returned a malformed response");
    return response;
  };

  const dumpState = async () => {
    const response = await forward({
      jsonrpc: "2.0",
      id: `crip-gateway-${randomUUID()}`,
      method: "anvil_dumpState",
      params: [],
    });
    if (
      response.error ||
      typeof response.result !== "string" ||
      !/^0x(?:[0-9a-f]{2})+$/i.test(response.result)
    )
      throw new Error("local Anvil state dump failed");
    const state = gunzipSync(Buffer.from(response.result.slice(2), "hex"));
    const parsed = JSON.parse(state.toString("utf8"));
    if (!validSnapshot(parsed))
      throw new Error("local Anvil state dump was invalid");
    return { state, parsed };
  };

  const writeSnapshot = async ({ state, parsed }) => {
    const temporary = `${snapshotPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, state, { mode: 0o600, flag: "wx" });
      await rename(temporary, snapshotPath);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    return parsed;
  };

  const persistState = async () => writeSnapshot(await dumpState());

  if (!poisoned) {
    try {
      const chain = await forward({
        jsonrpc: "2.0",
        id: "crip-gateway-health",
        method: "eth_chainId",
        params: [],
      });
      if (chain.error || chain.result !== "0x7a69")
        throw new Error("local Anvil chain ID did not match 31337");
      const current = await dumpState();
      let previous;
      try {
        previous = JSON.parse(await readFile(snapshotPath, "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (
        previous !== undefined &&
        (!validSnapshot(previous) ||
          !restoredSnapshotMatches(previous, current.parsed))
      )
        throw new Error(
          "restored Anvil state did not match its durable snapshot",
        );
      if (previous === undefined) await writeSnapshot(current);
    } catch {
      await poison("Anvil startup state could not be verified");
    }
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`,
      );
      if (request.method === "GET" && url.pathname === "/healthz") {
        if (poisoned) {
          response.writeHead(503);
          response.end("not ready");
          return;
        }
        try {
          const chain = await forward({
            jsonrpc: "2.0",
            id: "crip-gateway-health",
            method: "eth_chainId",
            params: [],
          });
          response.writeHead(
            !chain.error && chain.result === "0x7a69" ? 200 : 503,
          );
          response.end();
        } catch {
          response.writeHead(503);
          response.end();
        }
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/") {
        response.writeHead(404);
        response.end();
        return;
      }
      if (poisoned) {
        sendJson(
          response,
          503,
          jsonRpcError(null, -32000, "local Anvil gateway is unavailable"),
        );
        return;
      }

      let body;
      try {
        body = JSON.parse(await readBody(request));
      } catch {
        sendJson(
          response,
          200,
          jsonRpcError(null, -32700, "invalid JSON-RPC request"),
        );
        return;
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        body.jsonrpc !== "2.0" ||
        !(
          typeof body.id === "string" ||
          (typeof body.id === "number" && Number.isFinite(body.id))
        ) ||
        typeof body.method !== "string" ||
        (body.params !== undefined && !Array.isArray(body.params))
      ) {
        sendJson(
          response,
          200,
          jsonRpcError(null, -32600, "invalid JSON-RPC request"),
        );
        return;
      }
      const params = body.params ?? [];
      if (body.method === "anvil_reset" || body.method === "hardhat_reset") {
        if (params.length !== 0) {
          sendJson(
            response,
            200,
            jsonRpcError(body.id, -32602, "fork resets are disabled"),
          );
          return;
        }
      }
      const isRead = READ_METHODS.has(body.method);
      const isMutation = MUTATION_METHODS.has(body.method);
      if (!isRead && !isMutation) {
        sendJson(
          response,
          200,
          jsonRpcError(body.id, -32601, "unsupported local Anvil RPC method"),
        );
        return;
      }

      const execute = async () => {
        try {
          const result = await forward({ ...body, params });
          if (isMutation) await persistState();
          return result;
        } catch {
          if (isMutation)
            await poison(
              "Anvil mutation outcome or snapshot could not be verified",
            );
          throw new Error("local Anvil RPC is unavailable");
        }
      };

      try {
        const result = isMutation
          ? await withChainMutationLease(lockPath, execute)
          : await execute();
        sendJson(response, 200, result);
      } catch {
        sendJson(
          response,
          poisoned ? 503 : 200,
          jsonRpcError(body.id, -32000, "local Anvil RPC is unavailable"),
        );
      }
    })().catch(() => {
      if (!response.headersSent) {
        sendJson(
          response,
          500,
          jsonRpcError(null, -32603, "local Anvil gateway failed"),
        );
      } else {
        response.destroy();
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("gateway did not bind a TCP port");
  return {
    url: `http://${host}:${address.port}`,
    close: async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
};

if (process.env.ANVIL_RPC_UPSTREAM) {
  const port = Number(process.env.PORT ?? 8545);
  await startAnvilRpcGateway({
    upstreamUrl: process.env.ANVIL_RPC_UPSTREAM,
    lockPath: process.env.ANVIL_MUTATION_LOCK_FILE ?? "/run/crip/anvil.lock",
    snapshotPath: process.env.ANVIL_STATE_FILE ?? "/var/lib/anvil/state.json",
    poisonPath: process.env.ANVIL_POISON_FILE ?? "/run/crip/anvil.poisoned",
    host: "0.0.0.0",
    port,
  });
}
