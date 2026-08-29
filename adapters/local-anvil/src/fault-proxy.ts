import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const LOOPBACK = "127.0.0.1";
const LOCAL_CHAIN_ID = "0x7a69";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REDACTED = "REDACTED";
const WRONG_HASH = `0x${"00".repeat(31)}01`;
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;

export const FAULT_PROXY_MODES = [
  "passthrough",
  "unavailable-before-send",
  "explicit-rpc-rejection",
  "forward-then-drop",
  "wrong-transaction-hash",
  "mutated-transaction",
  "mutated-receipt",
  "withhold-receipt",
  "crash-before-send",
  "crash-after-forward",
] as const;

export type FaultProxyMode = (typeof FAULT_PROXY_MODES)[number];
type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

interface RequestRecord {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: unknown;
  readonly mode: FaultProxyMode;
  forwarded: boolean;
}

export interface FaultProxyRequest {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: unknown;
  readonly mode: FaultProxyMode;
  readonly forwarded: boolean;
}

export interface FaultProxyModeOptions {
  method?: string;
  rejectionCode?: number;
  rejectionMessage?: string;
}

export interface FaultProxyOptions {
  /** The only permitted upstream is the current checkout's loopback Anvil. */
  upstreamUrl: string;
  /** When supplied, require upstreamUrl to match this checkout's runtime.env. */
  root?: string;
  mode?: FaultProxyMode;
  method?: string;
  rejectionCode?: number;
  rejectionMessage?: string;
}

export interface FaultProxy {
  readonly url: string;
  readonly port: number;
  readonly crashed: boolean;
  setMode(mode: FaultProxyMode, options?: FaultProxyModeOptions): void;
  releaseReceipt(): void;
  waitForRequest(method?: string): Promise<FaultProxyRequest>;
  waitForForward(method?: string): Promise<FaultProxyRequest>;
  requestCount(method?: string): number;
  forwardCount(method?: string): number;
  requests(): readonly FaultProxyRequest[];
  close(): Promise<void>;
}

interface ModeRule {
  mode: FaultProxyMode;
  rejectionCode: number;
  rejectionMessage: string;
}

interface RuntimeModule {
  loadLocalRuntime(input: { root: string; environment?: NodeJS.ProcessEnv }): {
    anvil: { rpcUrl: string };
  };
}

const methodForMode = (mode: FaultProxyMode): string | undefined => {
  if (
    mode === "unavailable-before-send" ||
    mode === "explicit-rpc-rejection" ||
    mode === "forward-then-drop" ||
    mode === "wrong-transaction-hash" ||
    mode === "crash-before-send" ||
    mode === "crash-after-forward"
  )
    return "eth_sendRawTransaction";
  if (mode === "mutated-transaction") return "eth_getTransactionByHash";
  if (mode === "mutated-receipt" || mode === "withhold-receipt")
    return "eth_getTransactionReceipt";
  return undefined;
};

const assertLoopbackUpstream = (upstreamUrl: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(upstreamUrl);
  } catch {
    throw new Error(
      "fault proxy upstream must be a loopback-only local Anvil URL",
    );
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== LOOPBACK ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^[1-9][0-9]{3,4}$/.test(parsed.port) ||
    Number(parsed.port) < 1024 ||
    Number(parsed.port) > 65535
  )
    throw new Error(
      "fault proxy upstream must be a loopback-only local Anvil URL",
    );
  return parsed;
};

const assertCurrentCheckoutUpstream = async (
  root: string | undefined,
  upstream: URL,
): Promise<void> => {
  if (root === undefined) return;
  const module = (await import(
    pathToFileURL(join(root, "tooling/local-runtime.mjs")).href
  )) as unknown as RuntimeModule;
  const runtime = module.loadLocalRuntime({ root, environment: {} });
  if (new URL(runtime.anvil.rpcUrl).origin !== upstream.origin)
    throw new Error(
      "fault proxy upstream is not this checkout's Anvil runtime",
    );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseRequest = (value: unknown): JsonRpcRequest => {
  if (!isRecord(value) || value.jsonrpc !== "2.0")
    throw new Error("invalid JSON-RPC request");
  if (
    (typeof value.id !== "string" &&
      typeof value.id !== "number" &&
      value.id !== null) ||
    typeof value.method !== "string" ||
    value.method.length === 0
  )
    throw new Error("invalid JSON-RPC request");
  return {
    jsonrpc: "2.0",
    id: value.id,
    method: value.method,
    ...(value.params === undefined ? {} : { params: value.params }),
  };
};

const redactInspection = (method: string, params: unknown): unknown => {
  if (method === "eth_sendRawTransaction") return [REDACTED];
  return params;
};

const copyForInspection = (record: RequestRecord): FaultProxyRequest => ({
  id: record.id,
  method: record.method,
  params: record.params,
  mode: record.mode,
  forwarded: record.forwarded,
});

const mutateTransaction = (result: unknown): unknown =>
  isRecord(result) ? { ...result, from: ZERO_ADDRESS } : result;

const mutateReceipt = (result: unknown): unknown =>
  isRecord(result)
    ? { ...result, status: "0x0", transactionHash: WRONG_HASH }
    : result;

const mutateResponse = (
  response: JsonRpcResponse,
  mode: FaultProxyMode,
): JsonRpcResponse => {
  if (mode === "wrong-transaction-hash")
    return { jsonrpc: "2.0", id: response.id, result: WRONG_HASH };
  if (mode === "mutated-transaction")
    return {
      jsonrpc: "2.0",
      id: response.id,
      result: mutateTransaction(response.result),
    };
  if (mode === "mutated-receipt")
    return {
      jsonrpc: "2.0",
      id: response.id,
      result: mutateReceipt(response.result),
    };
  return response;
};

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const sendJson = (
  response: ServerResponse,
  status: number,
  body: JsonRpcResponse,
): void => {
  if (response.destroyed) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
};

export const createFaultProxy = async (
  options: FaultProxyOptions,
): Promise<FaultProxy> => {
  const upstream = assertLoopbackUpstream(options.upstreamUrl);
  await assertCurrentCheckoutUpstream(options.root, upstream);

  const rules = new Map<string, ModeRule>();
  const records: RequestRecord[] = [];
  const waiters: Array<{
    method: string | undefined;
    forwarded: boolean;
    resolve: (record: FaultProxyRequest) => void;
  }> = [];
  const activeResponses = new Set<ServerResponse>();
  const activeUpstreamRequests = new Set<AbortController>();
  let receiptReleased = false;
  let crashed = false;
  let closed = false;

  const defaultRule = (): ModeRule => ({
    mode: "passthrough",
    rejectionCode: -32000,
    rejectionMessage: "deterministic RPC rejection",
  });

  const setRule = (
    mode: FaultProxyMode,
    modeOptions: FaultProxyModeOptions = {},
  ): void => {
    const method = modeOptions.method ?? methodForMode(mode) ?? "*";
    if (mode === "passthrough" && modeOptions.method === undefined) {
      rules.clear();
      return;
    }
    rules.set(method, {
      mode,
      rejectionCode: modeOptions.rejectionCode ?? -32000,
      rejectionMessage:
        modeOptions.rejectionMessage ?? "deterministic RPC rejection",
    });
  };
  setRule(options.mode ?? "passthrough", {
    ...(options.method === undefined ? {} : { method: options.method }),
    ...(options.rejectionCode === undefined
      ? {}
      : { rejectionCode: options.rejectionCode }),
    ...(options.rejectionMessage === undefined
      ? {}
      : { rejectionMessage: options.rejectionMessage }),
  });

  const ruleFor = (method: string): ModeRule =>
    rules.get(method) ?? rules.get("*") ?? defaultRule();

  const count = (method: string | undefined, forwarded: boolean): number =>
    records.filter(
      (record) =>
        (method === undefined || record.method === method) &&
        (!forwarded || record.forwarded),
    ).length;

  const notifyWaiters = (record: RequestRecord): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (
        waiter &&
        (waiter.method === undefined || waiter.method === record.method) &&
        (!waiter.forwarded || record.forwarded)
      ) {
        waiters.splice(index, 1);
        waiter.resolve(copyForInspection(record));
      }
    }
  };

  const forward = async (
    request: JsonRpcRequest,
    record: RequestRecord,
  ): Promise<JsonRpcResponse | undefined> => {
    record.forwarded = true;
    notifyWaiters(record);
    const controller = new AbortController();
    activeUpstreamRequests.add(controller);
    let response: Response;
    try {
      response = await fetch(upstream.href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch {
      activeUpstreamRequests.delete(controller);
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      activeUpstreamRequests.delete(controller);
      return undefined;
    }
    activeUpstreamRequests.delete(controller);
    if (!isRecord(parsed) || parsed.jsonrpc !== "2.0") return undefined;
    return parsed as unknown as JsonRpcResponse;
  };

  const closeClient = (response: ServerResponse): void => {
    if (!response.destroyed) response.destroy();
  };

  const crash = (response: ServerResponse): void => {
    crashed = true;
    closeClient(response);
    server.close();
  };

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    activeResponses.add(response);
    response.once("close", () => activeResponses.delete(response));
    if (request.method !== "POST") {
      sendJson(response, 405, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "POST is required" },
      });
      return;
    }
    let parsed: JsonRpcRequest;
    try {
      parsed = parseRequest(JSON.parse(await readBody(request)));
    } catch {
      sendJson(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "invalid JSON-RPC request" },
      });
      return;
    }
    const rule = ruleFor(parsed.method);
    const record: RequestRecord = {
      id: parsed.id,
      method: parsed.method,
      params: redactInspection(parsed.method, parsed.params ?? []),
      mode: rule.mode,
      forwarded: false,
    };
    records.push(record);
    notifyWaiters(record);

    if (
      rule.mode === "unavailable-before-send" ||
      rule.mode === "crash-before-send"
    ) {
      if (rule.mode === "crash-before-send") crash(response);
      else closeClient(response);
      return;
    }
    if (rule.mode === "explicit-rpc-rejection") {
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: parsed.id,
        error: { code: rule.rejectionCode, message: rule.rejectionMessage },
      });
      return;
    }

    const upstreamResponse = await forward(parsed, record);
    if (rule.mode === "forward-then-drop") {
      closeClient(response);
      return;
    }
    if (rule.mode === "crash-after-forward") {
      crash(response);
      return;
    }
    if (upstreamResponse === undefined) {
      closeClient(response);
      return;
    }
    if (
      parsed.method === "eth_chainId" &&
      upstreamResponse.result !== LOCAL_CHAIN_ID
    ) {
      sendJson(response, 502, {
        jsonrpc: "2.0",
        id: parsed.id,
        error: { code: -32000, message: "refusing non-31337 upstream chain" },
      });
      return;
    }
    if (rule.mode === "withhold-receipt" && !receiptReleased) {
      await new Promise<void>((resolve) => {
        const release = (): void => resolve();
        receiptWaiters.push(release);
      });
    }
    sendJson(response, 200, mutateResponse(upstreamResponse, rule.mode));
  };

  const receiptWaiters: Array<() => void> = [];
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("fault proxy did not bind to a TCP port");
  }

  const proxy: FaultProxy = {
    get crashed() {
      return crashed;
    },
    port: address.port,
    url: `http://${LOOPBACK}:${address.port}`,
    setMode: (mode, modeOptions) => setRule(mode, modeOptions),
    releaseReceipt: () => {
      receiptReleased = true;
      while (receiptWaiters.length > 0) receiptWaiters.shift()?.();
    },
    waitForRequest: (method) => {
      const existing = records.find(
        (record) => method === undefined || record.method === method,
      );
      if (existing) return Promise.resolve(copyForInspection(existing));
      return new Promise<FaultProxyRequest>((resolve) => {
        waiters.push({ method, forwarded: false, resolve });
      });
    },
    waitForForward: (method) => {
      const existing = records.find(
        (record) =>
          record.forwarded &&
          (method === undefined || record.method === method),
      );
      if (existing) return Promise.resolve(copyForInspection(existing));
      return new Promise<FaultProxyRequest>((resolve) => {
        waiters.push({ method, forwarded: true, resolve });
      });
    },
    requestCount: (method) => count(method, false),
    forwardCount: (method) => count(method, true),
    requests: () => records.map(copyForInspection),
    close: async () => {
      if (closed) return;
      closed = true;
      proxy.releaseReceipt();
      for (const controller of activeUpstreamRequests) controller.abort();
      for (const response of activeResponses) closeClient(response);
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (
            error &&
            (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
          )
            reject(error);
          else resolve();
        });
      });
    },
  };
  return proxy;
};

export { LOCAL_CHAIN_ID };
