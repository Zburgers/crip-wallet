import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";

import { checkoutHash, loadLocalRuntime } from "./local-runtime.mjs";

/** @typedef {{ environment: string, chainId: string, anvilHost: string, anvilPort: number, rpcUrl: string }} RuntimeGuardInput */
/** @typedef {{ schemaVersion: number, fixture: string, fixtureInstanceId: string, checkoutHash: string, composeProject: string, chain: { caip2: string, chainId: number, host: string, port: number, rpcUrl: string, genesisBlockHash: string, genesisFingerprint: string }, deployer: { address: string, accountIndex: number }, token: { address: string, name: string, symbol: string, decimals: number, initialSupply: string, revertRecipient: string, artifactBytecodeHash: string, runtimeBytecodeHash: string }, deployment: { transactionHash: string, blockNumber: string, blockHash: string }, toolchain: { foundryImage: string, forgeVersion: string, anvilVersion: string, solcVersion: string, solcCompilerVersion: string }, createdAt: string, fingerprint: string }} FixtureDocument */
/** @typedef {{ runtime: ReturnType<typeof loadLocalRuntime>, anvil: { accounts: string[], privateKeys: string[], deployerAddress: string, deployerKey: string }, artifact: { runtimeBytecode: string, bytecodeHash: string, compilerVersion: string }, foundryImage: string, composeProject: string, rpcUrl: string, anvilHost: string }} FixtureContext */

export const EXPECTED_CHAIN_ID = "0x7a69";
export const EXPECTED_CAIP2 = "eip155:31337";
export const EXPECTED_TOKEN_NAME = "Crip Test USD";
export const EXPECTED_TOKEN_SYMBOL = "TEST_USDC";
export const EXPECTED_TOKEN_DECIMALS = 6;
export const EXPECTED_INITIAL_SUPPLY = "1000000000000";
export const FIXTURE_SCHEMA_VERSION = 1;
export const FIXTURE_NAME = "phase2-local-erc20";

const LOOPBACK = "127.0.0.1";
const DEPLOYER_ACCOUNT_INDEX = 0;
const DEPLOYER_KEY_CONTAINER_PATH = "/tmp/crip-wallet-deployer.key";
const FIXTURE_PATH = ".local/phase2-fixture.json";
const ANVIL_CONFIG_PATH = ".local/anvil/anvil.json";
const ARTIFACT_PATH = "contracts/out/MockERC20.sol/MockERC20.json";
const BROADCAST_PATH =
  "contracts/broadcast/DeployMockERC20.s.sol/31337/run-latest.json";
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const KEY_PATTERN = /^0x[0-9a-f]{64}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FIXTURE_INSTANCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_KEY_PATTERN =
  /private.?key|mnemonic|seed.?phrase|password|secret/i;
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

/** @param {string} value @returns {string} */
const lower = (value) => value.toLowerCase();

/** @param {string} value @returns {string} */
const requireAddress = (value) => {
  if (!ADDRESS_PATTERN.test(value)) throw new Error("invalid address");
  return lower(value);
};

/** @param {string} value @returns {string} */
const requireHash = (value) => {
  if (!HASH_PATTERN.test(value)) throw new Error("invalid hash");
  return lower(value);
};

/** @param {string} value @returns {string} */
const requireQuantity = (value) => {
  if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error("invalid RPC quantity");
  return BigInt(value).toString();
};

/** @param {string} value @returns {string} */
const hashBytes = (value) => {
  if (!/^0x[0-9a-f]*$/i.test(value) || (value.length - 2) % 2 !== 0) {
    throw new Error("invalid bytecode");
  }
  return `sha256:${createHash("sha256")
    .update(Buffer.from(value.slice(2), "hex"))
    .digest("hex")}`;
};

/** @param {unknown} value @returns {void} */
const rejectSecretKeys = (value) => {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key))
      throw new Error("fixture contains prohibited secret material");
    rejectSecretKeys(child);
  }
};

/** @param {string} path */
const requireMode600 = (path) => {
  if ((statSync(path).mode & 0o777) !== 0o600) {
    throw new Error(`sensitive local state must be mode 0600: ${path}`);
  }
};

/** @param {RuntimeGuardInput} input */
export const assertLocalOnlyRuntime = (input) => {
  if (input.environment !== "local")
    throw new Error("refusing non-local runtime");
  if (input.chainId !== EXPECTED_CAIP2) {
    throw new Error("refusing non-31337 chain configuration");
  }
  if (input.anvilHost !== LOOPBACK) {
    throw new Error("refusing non-loopback RPC; runtime must be loopback-only");
  }
  if (
    !Number.isInteger(input.anvilPort) ||
    input.anvilPort < 1024 ||
    input.anvilPort > 65535
  ) {
    throw new Error("invalid Anvil port");
  }
  if (input.rpcUrl !== `http://${LOOPBACK}:${input.anvilPort}`) {
    throw new Error("refusing non-loopback RPC URL");
  }
};

/** @param {string} source @param {string[] | undefined} expectedAccounts */
export const parseAnvilConfig = (source, expectedAccounts) => {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("malformed Anvil configuration", { cause: error });
  }
  if (
    !parsed ||
    !Array.isArray(parsed.available_accounts) ||
    !Array.isArray(parsed.private_keys) ||
    parsed.available_accounts.length === 0 ||
    parsed.available_accounts.length !== parsed.private_keys.length
  ) {
    throw new Error("refusing unexpected disposable account fixture");
  }
  const accounts = parsed.available_accounts.map(requireAddress);
  const privateKeys = parsed.private_keys.map(
    /** @param {unknown} value */ (value) => {
      if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
        throw new Error("malformed Anvil account state");
      }
      return value;
    },
  );
  if (new Set(accounts).size !== accounts.length) {
    throw new Error("duplicate disposable Anvil account");
  }
  if (
    expectedAccounts &&
    JSON.stringify(accounts) !== JSON.stringify(expectedAccounts.map(lower))
  ) {
    throw new Error("refusing unexpected deterministic Anvil account fixture");
  }
  return { accounts, privateKeys };
};

/** @param {string} root @returns {string[]} */
const expectedAccountsFor = (root) => {
  const statusScript = readFileSync(
    join(root, "scripts/dev-status.sh"),
    "utf8",
  );
  const match = /readonly EXPECTED_ACCOUNTS='([^']+)'/.exec(statusScript);
  if (!match?.[1])
    throw new Error("deterministic Anvil account authority is missing");
  try {
    const accounts = JSON.parse(match[1]);
    if (!Array.isArray(accounts)) throw new Error("not an account list");
    return accounts.map(requireAddress);
  } catch (error) {
    throw new Error("deterministic Anvil account authority is malformed", {
      cause: error,
    });
  }
};

/** @param {string} root @returns {{ accounts: string[], privateKeys: string[], deployerAddress: string, deployerKey: string }} */
const loadAnvilState = (root) => {
  const path = join(root, ANVIL_CONFIG_PATH);
  if (!existsSync(path)) throw new Error("Anvil runtime state is missing");
  requireMode600(path);
  const parsed = parseAnvilConfig(
    readFileSync(path, "utf8"),
    expectedAccountsFor(root),
  );
  return {
    accounts: parsed.accounts,
    privateKeys: parsed.privateKeys,
    deployerAddress: parsed.accounts[DEPLOYER_ACCOUNT_INDEX],
    deployerKey: parsed.privateKeys[DEPLOYER_ACCOUNT_INDEX],
  };
};

/** @param {string} root @returns {string} */
const foundryImageFor = (root) => {
  const compose = readFileSync(join(root, "compose.yaml"), "utf8");
  const match =
    /image:\s+(ghcr\.io\/foundry-rs\/foundry:stable@sha256:[a-f0-9]{64})/.exec(
      compose,
    );
  if (!match?.[1])
    throw new Error("pinned Foundry image is missing from compose.yaml");
  return match[1];
};

/** @param {string} root @returns {FixtureContext} */
const loadContext = (root) => {
  const runtimePath = join(root, ".local/runtime.env");
  if (!existsSync(runtimePath))
    throw new Error(
      "local runtime is not initialized; run npm run dev:up first",
    );
  requireMode600(runtimePath);
  const runtime = loadLocalRuntime({ root, environment: {} });
  assertLocalOnlyRuntime({
    environment: runtime.values.CRIP_ENVIRONMENT ?? "",
    chainId: runtime.values.CRIP_CHAIN_ID ?? "",
    anvilHost: runtime.anvil.host ?? "",
    anvilPort: runtime.anvil.port,
    rpcUrl: runtime.anvil.rpcUrl ?? "",
  });
  const composeProject = runtime.composeProject;
  const rpcUrl = runtime.anvil.rpcUrl;
  const anvilHost = runtime.anvil.host;
  if (!composeProject || !rpcUrl || !anvilHost) {
    throw new Error("local runtime identity is incomplete");
  }
  const artifactPath = join(root, ARTIFACT_PATH);
  if (!existsSync(artifactPath))
    throw new Error(
      "MockERC20 artifact is missing; run npm run contracts:test first",
    );
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (error) {
    throw new Error("MockERC20 artifact is malformed", { cause: error });
  }
  const runtimeBytecode = artifact?.deployedBytecode?.object;
  if (typeof runtimeBytecode !== "string" || runtimeBytecode === "0x") {
    throw new Error("MockERC20 runtime bytecode is missing");
  }
  let compilerVersion = "unknown";
  if (artifact.metadata && typeof artifact.metadata === "object") {
    compilerVersion = artifact.metadata.compiler?.version ?? compilerVersion;
  } else if (typeof artifact.metadata === "string") {
    try {
      compilerVersion =
        JSON.parse(artifact.metadata)?.compiler?.version ?? compilerVersion;
    } catch {
      throw new Error("MockERC20 artifact metadata is malformed");
    }
  }
  return {
    runtime,
    anvil: loadAnvilState(root),
    artifact: {
      runtimeBytecode,
      bytecodeHash: hashBytes(runtimeBytecode),
      compilerVersion,
    },
    foundryImage: foundryImageFor(root),
    composeProject,
    rpcUrl,
    anvilHost,
  };
};

/** @param {FixtureDocument} fixture @returns {Record<string, unknown>} */
const fingerprintPayload = (fixture) => ({
  schemaVersion: fixture.schemaVersion,
  fixture: fixture.fixture,
  fixtureInstanceId: fixture.fixtureInstanceId,
  checkoutHash: fixture.checkoutHash,
  composeProject: fixture.composeProject,
  chain: fixture.chain,
  deployer: fixture.deployer,
  token: fixture.token,
  deployment: fixture.deployment,
  toolchain: fixture.toolchain,
  createdAt: fixture.createdAt,
});

/** @param {FixtureDocument} fixture @returns {string} */
export const computeFixtureFingerprint = (fixture) =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(fingerprintPayload(fixture)))
    .digest("hex")}`;

/** @param {FixtureDocument} fixture @param {{ expectedCheckoutHash?: string, expectedComposeProject?: string }} [expected] */
export const validateFixtureDocument = (fixture, expected = {}) => {
  rejectSecretKeys(fixture);
  if (
    !fixture ||
    fixture.schemaVersion !== FIXTURE_SCHEMA_VERSION ||
    fixture.fixture !== FIXTURE_NAME
  ) {
    throw new Error("unsupported fixture schema");
  }
  if (
    expected.expectedCheckoutHash &&
    fixture.checkoutHash !== expected.expectedCheckoutHash
  ) {
    throw new Error("fixture belongs to a different checkout");
  }
  if (
    expected.expectedComposeProject &&
    fixture.composeProject !== expected.expectedComposeProject
  ) {
    throw new Error("fixture Compose project does not match this checkout");
  }
  if (
    typeof fixture.fixtureInstanceId !== "string" ||
    !FIXTURE_INSTANCE_ID_PATTERN.test(fixture.fixtureInstanceId)
  ) {
    throw new Error("fixture instance ID is invalid");
  }
  if (
    fixture.chain.caip2 !== EXPECTED_CAIP2 ||
    fixture.chain.chainId !== 31337
  ) {
    throw new Error("fixture is not bound to Anvil 31337");
  }
  assertLocalOnlyRuntime({
    environment: "local",
    chainId: fixture.chain.caip2,
    anvilHost: fixture.chain.host,
    anvilPort: fixture.chain.port,
    rpcUrl: fixture.chain.rpcUrl,
  });
  requireAddress(fixture.deployer.address);
  if (fixture.deployer.accountIndex !== DEPLOYER_ACCOUNT_INDEX)
    throw new Error("unexpected deployer account");
  requireAddress(fixture.token.address);
  if (
    fixture.token.name !== EXPECTED_TOKEN_NAME ||
    fixture.token.symbol !== EXPECTED_TOKEN_SYMBOL ||
    fixture.token.decimals !== EXPECTED_TOKEN_DECIMALS ||
    fixture.token.initialSupply !== EXPECTED_INITIAL_SUPPLY ||
    !SHA256_PATTERN.test(fixture.token.artifactBytecodeHash) ||
    !SHA256_PATTERN.test(fixture.token.runtimeBytecodeHash)
  ) {
    throw new Error("fixture token metadata is unexpected");
  }
  if (
    lower(fixture.token.revertRecipient) !==
    "0x000000000000000000000000000000000000dead"
  ) {
    throw new Error("fixture revert seam is unexpected");
  }
  requireHash(fixture.deployment.transactionHash);
  requireHash(fixture.deployment.blockHash);
  if (!/^\d+$/.test(fixture.deployment.blockNumber))
    throw new Error("fixture deployment block is invalid");
  requireHash(fixture.chain.genesisBlockHash);
  if (!SHA256_PATTERN.test(fixture.chain.genesisFingerprint))
    throw new Error("fixture genesis fingerprint is invalid");
  if (
    !/^ghcr\.io\/foundry-rs\/foundry:stable@sha256:[a-f0-9]{64}$/.test(
      fixture.toolchain.foundryImage,
    ) ||
    !/^1\.5\.1-stable \([a-f0-9]{40}\)$/.test(fixture.toolchain.forgeVersion) ||
    !/^1\.5\.1-stable \([a-f0-9]{40}\)$/.test(fixture.toolchain.anvilVersion) ||
    fixture.toolchain.solcVersion !== "0.8.30" ||
    !/^0\.8\.30\+commit\.[a-f0-9]+$/.test(fixture.toolchain.solcCompilerVersion)
  ) {
    throw new Error("fixture toolchain fingerprint is unexpected");
  }
  if (fixture.fingerprint !== computeFixtureFingerprint(fixture)) {
    throw new Error("fixture fingerprint mismatch");
  }
  return fixture;
};

/** @param {{ root?: string }} [options] @returns {FixtureDocument} */
export const readFixture = ({ root = repositoryRoot } = {}) => {
  const path = join(root, FIXTURE_PATH);
  if (!existsSync(path))
    throw new Error(
      "Phase-2 fixture is missing; run npm run fixture:phase2 first",
    );
  requireMode600(path);
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("Phase-2 fixture is malformed", { cause: error });
  }
  return validateFixtureDocument(fixture);
};

/** @param {string} root @param {string} entrypoint @param {string[]} args @param {string[]} mounts @param {boolean} hostNetwork */
const runFoundry = (
  root,
  entrypoint,
  args,
  mounts = [],
  hostNetwork = false,
) => {
  const dockerArgs = ["run", "--rm", "--env", "HOME=/tmp"];
  if (
    typeof process.getuid === "function" &&
    typeof process.getgid === "function"
  )
    dockerArgs.push("--user", `${process.getuid()}:${process.getgid()}`);
  if (hostNetwork) dockerArgs.push("--network", "host");
  dockerArgs.push("--entrypoint", entrypoint);
  dockerArgs.push(
    "--mount",
    `type=bind,src=${join(root, "contracts")},dst=/workspace`,
  );
  for (const mount of mounts) dockerArgs.push("--mount", mount);
  dockerArgs.push("--workdir", "/workspace", foundryImageFor(root), ...args);
  const result = spawnSync("docker", dockerArgs, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    error: result.error,
  };
};

/** @param {string} output @returns {string} */
const parseVersion = (output) => {
  const version = /Version:\s+([^\s]+)/.exec(output)?.[1];
  const commit = /Commit SHA:\s+([^\s]+)/.exec(output)?.[1];
  if (!version || !commit)
    throw new Error("unable to determine pinned Foundry tool version");
  return `${version} (${commit})`;
};

/** @param {string} output @param {string} privateKey */
const assertSecretFreeOutput = (output, privateKey) => {
  const normalized = privateKey.toLowerCase();
  const withoutPrefix = normalized.replace(/^0x/, "");
  const decimal = BigInt(privateKey).toString();
  if (
    [normalized, withoutPrefix, decimal].some((secret) =>
      output.toLowerCase().includes(secret),
    )
  ) {
    throw new Error("deployment command disclosed private key material");
  }
};

let rpcRequestId = 1;

/** @param {ReturnType<typeof loadLocalRuntime>} runtime @param {string} method @param {unknown[]} params @returns {Promise<any>} */
const rpcCall = async (runtime, method, params) => {
  const id = rpcRequestId;
  const rpcUrl = runtime.anvil.rpcUrl;
  if (!rpcUrl) throw new Error("local runtime RPC URL is missing");
  rpcRequestId += 1;
  const response = await globalThis.fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`local RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (
    !payload ||
    payload.id !== id ||
    payload.error ||
    !("result" in payload)
  ) {
    throw new Error(`local RPC rejected ${method}`);
  }
  return payload.result;
};

/** @param {ReturnType<typeof loadLocalRuntime>} runtime @param {string} method @param {unknown[]} params */
const safeRpcCall = async (runtime, method, params) => {
  try {
    return await rpcCall(runtime, method, params);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("local RPC request timed out", { cause: error });
    throw error;
  }
};

/** @param {{ root?: string }} [options] @returns {Promise<void>} */
export const resetPhase2Anvil = async ({ root = repositoryRoot } = {}) => {
  const context = loadContext(root);
  const result = await safeRpcCall(context.runtime, "anvil_reset", []);
  if (result !== null && result !== true) {
    throw new Error("local Anvil reset was not confirmed");
  }
};

/** @param {ReturnType<typeof loadLocalRuntime>} runtime @returns {Promise<{ hash: string, fingerprint: string }>} */
const readGenesis = async (runtime) => {
  const block = await safeRpcCall(runtime, "eth_getBlockByNumber", [
    "0x0",
    false,
  ]);
  if (!block || typeof block !== "object")
    throw new Error("local genesis block is missing");
  const genesis = {
    hash: requireHash(block.hash),
    parentHash: requireHash(block.parentHash),
    stateRoot: requireHash(block.stateRoot),
    transactionsRoot: requireHash(block.transactionsRoot),
    receiptsRoot: requireHash(block.receiptsRoot),
    timestamp: requireQuantity(block.timestamp),
    gasLimit: requireQuantity(block.gasLimit),
    baseFeePerGas:
      block.baseFeePerGas == null ? null : requireQuantity(block.baseFeePerGas),
  };
  return {
    hash: genesis.hash,
    fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(genesis)).digest("hex")}`,
  };
};

/** @param {ReturnType<typeof loadLocalRuntime>} runtime @param {string} address @param {string} data */
const ethCall = async (runtime, address, data) => {
  const result = await safeRpcCall(runtime, "eth_call", [
    { to: address, data },
    "latest",
  ]);
  if (typeof result !== "string")
    throw new Error("local RPC returned malformed eth_call data");
  return result;
};

/** @param {string} value @returns {string} */
const decodeWord = (value) => {
  if (!/^0x[0-9a-f]*$/i.test(value) || value.length < 66)
    throw new Error("malformed token call result");
  return value.slice(2, 66);
};

/** @param {string} value @returns {string} */
const decodeString = (value) => {
  const offset = Number(BigInt(`0x${decodeWord(value)}`));
  const lengthStart = 2 + offset * 2;
  if (!Number.isSafeInteger(offset) || lengthStart + 64 > value.length)
    throw new Error("malformed token string result");
  const length = Number(
    BigInt(`0x${value.slice(lengthStart, lengthStart + 64)}`),
  );
  const dataStart = lengthStart + 64;
  const dataEnd = dataStart + length * 2;
  if (!Number.isSafeInteger(length) || dataEnd > value.length)
    throw new Error("malformed token string result");
  return Buffer.from(value.slice(dataStart, dataEnd), "hex").toString("utf8");
};

/** @param {string} address @returns {string} */
const balanceOfCall = (address) =>
  `0x70a08231${"0".repeat(24)}${requireAddress(address).slice(2)}`;

/** @param {ReturnType<typeof loadLocalRuntime>} runtime @param {string} token @param {string} deployer @param {string} [recipient] */
const readTokenMetadata = async (runtime, token, deployer, recipient) => {
  const name = decodeString(await ethCall(runtime, token, "0x06fdde03"));
  const symbol = decodeString(await ethCall(runtime, token, "0x95d89b41"));
  const decimals = Number(
    BigInt(`0x${decodeWord(await ethCall(runtime, token, "0x313ce567"))}`),
  );
  const totalSupply = BigInt(
    `0x${decodeWord((await ethCall(runtime, token, "0x18160ddd")) || "0x")}`,
  ).toString();
  const deployerTokenBalance = BigInt(
    `0x${decodeWord(await ethCall(runtime, token, balanceOfCall(deployer)))}`,
  ).toString();
  const recipientTokenBalance = recipient
    ? BigInt(
        `0x${decodeWord(await ethCall(runtime, token, balanceOfCall(recipient)))}`,
      ).toString()
    : "0";
  return {
    name,
    symbol,
    decimals,
    totalSupply,
    deployerTokenBalance,
    recipientTokenBalance,
  };
};

/** @param {ReturnType<typeof loadLocalRuntime>} runtime @param {string} fixtureAddress @param {string} deployer @param {string} [recipient] @returns {Promise<{ chainId: string, codeHash: string, metadata: Awaited<ReturnType<typeof readTokenMetadata>>, deployerTokenBalance: string, recipientTokenBalance: string }>} */
const inspectToken = async (runtime, fixtureAddress, deployer, recipient) => {
  const chainId = await safeRpcCall(runtime, "eth_chainId", []);
  if (chainId !== EXPECTED_CHAIN_ID)
    throw new Error("refusing unexpected chain id");
  const code = await safeRpcCall(runtime, "eth_getCode", [
    fixtureAddress,
    "latest",
  ]);
  if (typeof code !== "string" || code === "0x")
    throw new Error("deployment code is missing");
  const metadata = await readTokenMetadata(
    runtime,
    fixtureAddress,
    deployer,
    recipient,
  );
  return {
    chainId,
    codeHash: hashBytes(code),
    metadata,
    deployerTokenBalance: metadata.deployerTokenBalance,
    recipientTokenBalance: metadata.recipientTokenBalance,
  };
};

/** @param {FixtureDocument} fixture @param {string} artifactHash */
const assertArtifactBinding = (fixture, artifactHash) => {
  if (
    fixture.token.artifactBytecodeHash !== artifactHash ||
    fixture.token.runtimeBytecodeHash !== artifactHash
  ) {
    throw new Error(
      "fixture artifact/code hash does not match the current artifact",
    );
  }
};

/** @param {{ root?: string, fixture?: FixtureDocument }} options @returns {Promise<{ chainId: string, codeHash: string, metadata: Awaited<ReturnType<typeof readTokenMetadata>>, deployerTokenBalance: string, recipientTokenBalance: string }>} */
export const verifyFixtureOnChain = async ({
  root = repositoryRoot,
  fixture = readFixture({ root }),
} = {}) => {
  const context = loadContext(root);
  const expectedHash = checkoutHash(root);
  validateFixtureDocument(fixture, {
    expectedCheckoutHash: expectedHash,
    expectedComposeProject: `crip-wallet-${expectedHash}`,
  });
  const current = readFixture({ root });
  if (current.fixtureInstanceId !== fixture.fixtureInstanceId) {
    throw new Error("stale fixture instance: fixture is not current");
  }
  assertArtifactBinding(fixture, context.artifact.bytecodeHash);
  const chainId = await safeRpcCall(context.runtime, "eth_chainId", []);
  if (chainId !== EXPECTED_CHAIN_ID)
    throw new Error("refusing unexpected chain id");
  const genesis = await readGenesis(context.runtime);
  if (
    fixture.chain.genesisBlockHash !== genesis.hash ||
    fixture.chain.genesisFingerprint !== genesis.fingerprint
  ) {
    throw new Error(
      "stale fixture: local genesis fingerprint does not match current chain",
    );
  }
  const receipt = await safeRpcCall(
    context.runtime,
    "eth_getTransactionReceipt",
    [fixture.deployment.transactionHash],
  );
  const transaction = await safeRpcCall(
    context.runtime,
    "eth_getTransactionByHash",
    [fixture.deployment.transactionHash],
  );
  if (
    !receipt ||
    !transaction ||
    lower(transaction.from ?? "") !== fixture.deployer.address ||
    lower(transaction.to ?? "") !== "" ||
    lower(receipt.contractAddress ?? "") !== fixture.token.address
  ) {
    throw new Error(
      "fixture deployment transaction does not match deployer/token",
    );
  }
  if (
    receipt.status !== "0x1" ||
    lower(receipt.blockHash) !== fixture.deployment.blockHash ||
    requireQuantity(receipt.blockNumber) !== fixture.deployment.blockNumber
  ) {
    throw new Error(
      "fixture deployment receipt is not the expected successful deployment",
    );
  }
  const inspected = await inspectToken(
    context.runtime,
    fixture.token.address,
    fixture.deployer.address,
  );
  if (
    inspected.codeHash !== fixture.token.runtimeBytecodeHash ||
    inspected.metadata.name !== fixture.token.name ||
    inspected.metadata.symbol !== fixture.token.symbol ||
    inspected.metadata.decimals !== fixture.token.decimals ||
    inspected.metadata.totalSupply !== fixture.token.initialSupply ||
    inspected.deployerTokenBalance !== fixture.token.initialSupply
  ) {
    throw new Error(
      "fixture deployment metadata or code hash does not match chain state",
    );
  }
  return inspected;
};

/** @param {string} root @returns {{ forgeVersion: string, anvilVersion: string }} */
const readToolVersions = (root) => {
  const forge = runFoundry(root, "forge", ["--version"]);
  const anvil = runFoundry(root, "anvil", ["--version"]);
  if (forge.status !== 0 || anvil.status !== 0)
    throw new Error("unable to inspect pinned Foundry tool versions");
  return {
    forgeVersion: parseVersion(forge.output),
    anvilVersion: parseVersion(anvil.output),
  };
};

/** @param {string} root @returns {{ transactionHash: string, contractAddress: string }} */
const readBroadcastDeployment = (root) => {
  const path = join(root, BROADCAST_PATH);
  if (!existsSync(path))
    throw new Error("Forge deployment evidence is missing");
  let broadcast;
  try {
    broadcast = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("Forge deployment evidence is malformed", { cause: error });
  }
  const candidates = [
    ...(Array.isArray(broadcast.transactions) ? broadcast.transactions : []),
    ...(Array.isArray(broadcast.receipts) ? broadcast.receipts : []),
  ];
  const candidate = candidates.find(
    (entry) =>
      entry &&
      (entry.contractName === "MockERC20" || entry.contractAddress) &&
      (entry.hash || entry.transactionHash || entry.receipt?.transactionHash),
  );
  const transactionHash =
    candidate?.hash ??
    candidate?.transactionHash ??
    candidate?.receipt?.transactionHash;
  const contractAddress =
    candidate?.contractAddress ?? candidate?.receipt?.contractAddress;
  if (
    typeof transactionHash !== "string" ||
    typeof contractAddress !== "string"
  ) {
    throw new Error("Forge deployment evidence does not identify MockERC20");
  }
  return {
    transactionHash: requireHash(transactionHash),
    contractAddress: requireAddress(contractAddress),
  };
};

/** @param {string} root @param {FixtureContext} context @returns {Promise<{ transactionHash: string, contractAddress: string }>} */
const deployToken = async (root, context) => {
  const temporaryDirectory = mkdtempSync(
    join(root, ".local", ".phase2-deploy-"),
  );
  chmodSync(temporaryDirectory, 0o700);
  const keyPath = join(temporaryDirectory, "deployer.key");
  writeFileSync(keyPath, BigInt(context.anvil.deployerKey).toString(), {
    mode: 0o600,
  });
  try {
    const result = runFoundry(
      root,
      "forge",
      [
        "script",
        "script/DeployMockERC20.s.sol:DeployMockERC20",
        "--rpc-url",
        context.rpcUrl,
        "--broadcast",
        "--quiet",
      ],
      [`type=bind,src=${keyPath},dst=${DEPLOYER_KEY_CONTAINER_PATH},readonly`],
      true,
    );
    assertSecretFreeOutput(result.output, context.anvil.deployerKey);
    if (result.status !== 0 || result.error)
      throw new Error("Forge deployment failed");
    return readBroadcastDeployment(root);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

/** @param {ReturnType<typeof loadLocalRuntime>} runtime @param {string} transactionHash @param {string} expectedDeployer */
const readDeploymentEvidence = async (
  runtime,
  transactionHash,
  expectedDeployer,
) => {
  const receipt = await safeRpcCall(runtime, "eth_getTransactionReceipt", [
    transactionHash,
  ]);
  const transaction = await safeRpcCall(runtime, "eth_getTransactionByHash", [
    transactionHash,
  ]);
  if (!receipt || !transaction || receipt.status !== "0x1")
    throw new Error("deployment transaction was not confirmed");
  if (
    lower(transaction.from ?? "") !== expectedDeployer ||
    lower(transaction.to ?? "") !== ""
  ) {
    throw new Error("deployment transaction sender/target is unexpected");
  }
  if (!receipt.contractAddress)
    throw new Error("deployment receipt has no contract address");
  const block = await safeRpcCall(runtime, "eth_getBlockByHash", [
    receipt.blockHash,
    false,
  ]);
  if (!block || lower(block.hash) !== lower(receipt.blockHash))
    throw new Error("deployment block evidence is missing");
  return {
    contractAddress: requireAddress(receipt.contractAddress),
    transactionHash: requireHash(transactionHash),
    blockNumber: requireQuantity(receipt.blockNumber),
    blockHash: requireHash(receipt.blockHash),
  };
};

/** @param {string} root @param {FixtureContext} context @returns {Promise<FixtureDocument>} */
const createFixture = async (root, context) => {
  const genesis = await readGenesis(context.runtime);
  const deployment = await deployToken(root, context);
  const evidence = await readDeploymentEvidence(
    context.runtime,
    deployment.transactionHash,
    context.anvil.deployerAddress,
  );
  if (evidence.contractAddress !== deployment.contractAddress) {
    throw new Error("deployment evidence address mismatch");
  }
  const inspected = await inspectToken(
    context.runtime,
    evidence.contractAddress,
    context.anvil.deployerAddress,
  );
  if (
    inspected.metadata.name !== EXPECTED_TOKEN_NAME ||
    inspected.metadata.symbol !== EXPECTED_TOKEN_SYMBOL ||
    inspected.metadata.decimals !== EXPECTED_TOKEN_DECIMALS ||
    inspected.metadata.totalSupply !== EXPECTED_INITIAL_SUPPLY ||
    inspected.deployerTokenBalance !== EXPECTED_INITIAL_SUPPLY ||
    inspected.codeHash !== context.artifact.bytecodeHash
  ) {
    throw new Error(
      "deployed MockERC20 failed independent fixture verification",
    );
  }
  const versions = readToolVersions(root);
  const solcVersion = /solc_version\s*=\s*"([^"]+)"/.exec(
    readFileSync(join(root, "contracts/foundry.toml"), "utf8"),
  )?.[1];
  if (!solcVersion) throw new Error("pinned Solc version is missing");
  /** @type {FixtureDocument} */
  const fixture = {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    fixture: FIXTURE_NAME,
    fixtureInstanceId: randomUUID(),
    checkoutHash: context.runtime.checkoutHash,
    composeProject: context.composeProject,
    chain: {
      caip2: EXPECTED_CAIP2,
      chainId: 31337,
      host: context.anvilHost,
      port: context.runtime.anvil.port,
      rpcUrl: context.rpcUrl,
      genesisBlockHash: genesis.hash,
      genesisFingerprint: genesis.fingerprint,
    },
    deployer: {
      address: context.anvil.deployerAddress,
      accountIndex: DEPLOYER_ACCOUNT_INDEX,
    },
    token: {
      address: evidence.contractAddress,
      name: inspected.metadata.name,
      symbol: inspected.metadata.symbol,
      decimals: inspected.metadata.decimals,
      initialSupply: inspected.metadata.totalSupply,
      revertRecipient: "0x000000000000000000000000000000000000dead",
      artifactBytecodeHash: context.artifact.bytecodeHash,
      runtimeBytecodeHash: inspected.codeHash,
    },
    deployment: {
      transactionHash: evidence.transactionHash,
      blockNumber: evidence.blockNumber,
      blockHash: evidence.blockHash,
    },
    toolchain: {
      foundryImage: context.foundryImage,
      forgeVersion: versions.forgeVersion,
      anvilVersion: versions.anvilVersion,
      solcVersion,
      solcCompilerVersion: context.artifact.compilerVersion,
    },
    createdAt: new Date().toISOString(),
    fingerprint: "",
  };
  fixture.fingerprint = computeFixtureFingerprint(fixture);
  validateFixtureDocument(fixture, {
    expectedCheckoutHash: context.runtime.checkoutHash,
    expectedComposeProject: context.composeProject,
  });
  const path = join(root, FIXTURE_PATH);
  const temporary = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(fixture, null, 2)}\n`, {
      mode: 0o600,
    });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  requireMode600(path);
  return fixture;
};

/** @param {FixtureContext} context @param {string} [tokenAddress] @returns {Promise<boolean>} */
const isCleanReset = async (context, tokenAddress) => {
  const blockNumber = requireQuantity(
    await safeRpcCall(context.runtime, "eth_blockNumber", []),
  );
  const nonce = requireQuantity(
    await safeRpcCall(context.runtime, "eth_getTransactionCount", [
      context.anvil.deployerAddress,
      "latest",
    ]),
  );
  if (blockNumber !== "0" || nonce !== "0") return false;
  if (!tokenAddress) return true;
  const code = await safeRpcCall(context.runtime, "eth_getCode", [
    tokenAddress,
    "latest",
  ]);
  return code === "0x";
};

/** @param {{ root?: string }} [options] @returns {Promise<FixtureDocument>} */
export const createPhase2Fixture = async ({ root = repositoryRoot } = {}) => {
  const context = loadContext(root);
  const fixturePath = join(root, FIXTURE_PATH);
  if (existsSync(fixturePath)) {
    let existing;
    try {
      existing = readFixture({ root });
    } catch (error) {
      if (!(await isCleanReset(context))) {
        throw new Error("existing Phase-2 fixture is invalid", {
          cause: error,
        });
      }
      return createFixture(root, context);
    }
    validateFixtureDocument(existing, {
      expectedCheckoutHash: context.runtime.checkoutHash,
      expectedComposeProject: context.composeProject,
    });
    try {
      await verifyFixtureOnChain({ root, fixture: existing });
      return existing;
    } catch (error) {
      if (!(await isCleanReset(context, existing.token.address))) {
        throw new Error(
          `stale fixture: ${error instanceof Error ? error.message : "chain state mismatch"}`,
          { cause: error },
        );
      }
    }
  } else if (!(await isCleanReset(context))) {
    throw new Error(
      "cannot create Phase-2 fixture on a non-empty chain; reset Anvil first",
    );
  }
  return createFixture(root, context);
};

/** @param {string} output @returns {string} */
const parseTransactionHash = (output) => {
  try {
    const parsed = JSON.parse(output);
    const candidate = parsed?.transactionHash ?? parsed?.hash;
    if (typeof candidate === "string") return requireHash(candidate);
  } catch {
    // Cast may include human-readable lines around its JSON result.
  }
  const match = /0x[0-9a-f]{64}/i.exec(output);
  if (!match)
    throw new Error("local transfer did not return a transaction hash");
  return requireHash(match[0]);
};

/** @param {{ root?: string, fixture: FixtureDocument, recipient: string, amount: string }} options @returns {Promise<{ transactionHash: string, deployerTokenBalance: string, recipientTokenBalance: string }>} */
export const runUnlockedTransfer = async ({
  root = repositoryRoot,
  fixture,
  recipient,
  amount,
}) => {
  const context = loadContext(root);
  validateFixtureDocument(fixture, {
    expectedCheckoutHash: context.runtime.checkoutHash,
    expectedComposeProject: context.composeProject,
  });
  const current = readFixture({ root });
  if (current.fixtureInstanceId !== fixture.fixtureInstanceId) {
    throw new Error("stale fixture instance: fixture is not current");
  }
  requireAddress(recipient);
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n)
    throw new Error("transfer amount must be a positive integer");
  await safeRpcCall(context.runtime, "anvil_impersonateAccount", [
    context.anvil.deployerAddress,
  ]);
  try {
    const result = runFoundry(
      root,
      "cast",
      [
        "send",
        "--rpc-url",
        context.rpcUrl,
        "--unlocked",
        "--from",
        context.anvil.deployerAddress,
        "--json",
        fixture.token.address,
        "transfer(address,uint256)",
        recipient,
        amount,
      ],
      [],
      true,
    );
    if (result.status !== 0 || result.error)
      throw new Error("local fake-token transfer failed");
    const transactionHash = parseTransactionHash(result.output);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const receipt = await safeRpcCall(
        context.runtime,
        "eth_getTransactionReceipt",
        [transactionHash],
      );
      if (receipt) {
        if (receipt.status !== "0x1")
          throw new Error("local fake-token transfer reverted");
        const balances = await readTokenMetadata(
          context.runtime,
          fixture.token.address,
          context.anvil.deployerAddress,
          recipient,
        );
        return {
          transactionHash,
          deployerTokenBalance: balances.deployerTokenBalance,
          recipientTokenBalance: balances.recipientTokenBalance,
        };
      }
      await new Promise((resolveNext) => globalThis.setImmediate(resolveNext));
    }
    throw new Error("local fake-token transfer was not confirmed");
  } finally {
    await safeRpcCall(context.runtime, "anvil_stopImpersonatingAccount", [
      context.anvil.deployerAddress,
    ]);
  }
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  createPhase2Fixture()
    .then((fixture) => {
      process.stdout.write(
        `Phase-2 fixture ready: chain=${fixture.chain.caip2} token=${fixture.token.address} fingerprint=${fixture.fingerprint}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `ERROR: ${error instanceof Error ? error.message : "unable to create Phase-2 fixture"}\n`,
      );
      process.exitCode = 1;
    });
}
