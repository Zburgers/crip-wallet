import {
  canonicalizeIdempotencyPayload,
  executableTransferCandidateSchema,
  simulationEvidenceSchema,
} from "@crip/schemas";
import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  stringToBytes,
} from "viem";

import {
  LOCAL_CHAIN_ID,
  type Address,
  type Hex,
  type TransferCoreCandidate,
  type VerifiedTransferCore,
} from "./candidate.js";

export type Hash = `0x${string}`;
export type SimulationOutcome = "success" | "revert";

export interface CanonicalBlock {
  number: bigint;
  hash: Hash;
  baseFeePerGas: bigint;
}

export interface SimulationRequest {
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
  blockNumber: bigint;
  nonce: bigint;
  accessList: readonly [];
}

export interface SimulationCallResult {
  outcome: SimulationOutcome;
  revertData?: Hex;
}

export interface FeeData {
  baseFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** The minimum read-only RPC surface needed by the one simulation authority. */
export interface LocalReadRpc {
  getChainId(): Promise<bigint>;
  getBlockNumber(): Promise<bigint>;
  getBlockByNumber(number: bigint): Promise<CanonicalBlock | null>;
  getBlockByHash(hash: Hash): Promise<CanonicalBlock | null>;
  getPendingNonce(address: Address): Promise<bigint>;
  getNativeBalance(address: Address, blockNumber: bigint): Promise<bigint>;
  getTokenBalance(
    tokenAddress: Address,
    address: Address,
    blockNumber: bigint,
  ): Promise<bigint>;
  simulateTransfer(request: SimulationRequest): Promise<SimulationCallResult>;
  estimateGas(request: SimulationRequest): Promise<bigint>;
  getFeeData(blockNumber: bigint): Promise<FeeData>;
  readonly rpcUrl?: string;
  readonly fixtureInstanceId?: string;
}

export interface LocalFixtureIdentity {
  fixtureInstanceId: string;
  chainId: typeof LOCAL_CHAIN_ID;
  walletAddress: Address;
  tokenAddress: Address;
  rpcUrl: string;
}

export interface ActiveFeeAndExecutionConstraints {
  intentMaximumNetworkFeeAtomic: string;
  policyMaximumNetworkFeeAtomic: string;
}

export interface ExecutableTransferCandidate extends TransferCoreCandidate {
  nonce: string;
  transactionType: "eip1559";
  gasLimit: string;
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
  accessList: readonly [];
}

export interface ExpectedAssetDelta {
  assetAddress: Address;
  from: Address;
  to: Address;
  amountAtomic: string;
}

export interface SimulationRevert {
  code: "EXECUTION_REVERT";
  data?: Hex;
}

export interface SimulationEvidence {
  schemaVersion: "1.0";
  fixtureInstanceId: string;
  chainId: typeof LOCAL_CHAIN_ID;
  blockNumber: string;
  blockHash: Hash;
  candidateHash: Hash;
  from: Address;
  to: Address;
  value: "0";
  calldata: Hex;
  senderNonce: string;
  tokenBalance: string;
  nativeBalance: string;
  gasEstimate: string;
  gasLimit: string;
  baseFeePerGas: string;
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
  accessList: readonly [];
  outcome: SimulationOutcome;
  revert?: SimulationRevert;
  expectedAssetDeltas: readonly ExpectedAssetDelta[];
  maximumNativeFeeAtomic: string;
  simulatorVersion: "viem@2.56.0";
  evidenceHash: Hash;
}

export interface SuccessfulFreshSimulation extends SimulationEvidence {
  outcome: "success";
}

export type SimulationFailureCode =
  | "INVALID_VERIFIED_CORE"
  | "INVALID_FIXTURE"
  | "WRONG_CHAIN"
  | "PUBLIC_RPC_FORBIDDEN"
  | "FIXTURE_MISMATCH"
  | "MISSING_BLOCK"
  | "NONCANONICAL_BLOCK"
  | "INVALID_RPC_EVIDENCE"
  | "SIMULATION_REVERT"
  | "INSUFFICIENT_TOKEN_BALANCE"
  | "INSUFFICIENT_NATIVE_BALANCE"
  | "INVALID_FEE_DATA"
  | "FEE_CEILING_CONFLICT";

export class SimulationResolutionError extends Error {
  readonly code: SimulationFailureCode;
  readonly simulation: SimulationEvidence | undefined;

  constructor(code: SimulationFailureCode, simulation?: SimulationEvidence) {
    super(code);
    this.name = "SimulationResolutionError";
    this.code = code;
    this.simulation = simulation;
  }
}

export type ExactVerificationFailureCode =
  | SimulationFailureCode
  | "EXECUTABLE_CHANGED"
  | "SIMULATION_CHANGED"
  | "INVALID_EXECUTABLE"
  | "PRIORITY_FEE_EXCEEDS_MAX_FEE";

export interface ExactVerificationFailure {
  ok: false;
  code: ExactVerificationFailureCode;
  field?: string;
}

export interface ExactVerifiedTransfer {
  ok: true;
  verified: ExecutableTransferCandidate;
}

export type ExactVerificationResult =
  ExactVerifiedTransfer | ExactVerificationFailure;

export type FreshnessFailureCode =
  | "FIXTURE_CHANGED"
  | "WRONG_CHAIN"
  | "NONCANONICAL_BLOCK"
  | "MISSING_BLOCK"
  | "BLOCK_TOO_OLD"
  | "NONCE_CHANGED"
  | "TOKEN_BALANCE_CHANGED"
  | "NATIVE_BALANCE_CHANGED"
  | "FEE_CEILING_CONFLICT"
  | "EXECUTABLE_CHANGED"
  | "SIMULATION_CHANGED";

export type FreshnessResult =
  { ok: true; reason: "FRESH" } | { ok: false; code: FreshnessFailureCode };

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ATOMIC_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const EXECUTABLE_KEYS = [
  "accessList",
  "action",
  "amountAtomic",
  "calldata",
  "chainId",
  "fixtureInstanceId",
  "from",
  "gasLimit",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "nativeValue",
  "nonce",
  "nonceStrategy",
  "provenance",
  "recipient",
  "selector",
  "target",
  "transactionType",
].sort();
const SIMULATOR_VERSION = "viem@2.56.0" as const;
const LOCAL_CHAIN_NUMBER = 31337n;

const isAtomic = (value: unknown): value is string =>
  typeof value === "string" && ATOMIC_PATTERN.test(value);

const asBigInt = (value: unknown, label: string): bigint => {
  if (typeof value !== "bigint" || value < 0n)
    throw new SimulationResolutionError("INVALID_RPC_EVIDENCE");
  void label;
  return value;
};

const canonicalHash = (value: unknown): value is Hash =>
  typeof value === "string" && HASH_PATTERN.test(value);

const canonicalAddress = (value: unknown): value is Address =>
  typeof value === "string" && ADDRESS_PATTERN.test(value);

const canonicalIdentifier = (value: unknown): value is string =>
  typeof value === "string" && IDENTIFIER_PATTERN.test(value);

const minAtomic = (left: string, right: string): string =>
  left.length < right.length || (left.length === right.length && left <= right)
    ? left
    : right;

const checkedProduct = (left: string, right: string): string => {
  if (!isAtomic(left) || !isAtomic(right))
    throw new SimulationResolutionError("INVALID_FEE_DATA");
  return (BigInt(left) * BigInt(right)).toString();
};

const canonicalJson = (value: unknown) =>
  JSON.parse(
    canonicalizeIdempotencyPayload(
      JSON.parse(JSON.stringify(value)) as Parameters<
        typeof canonicalizeIdempotencyPayload
      >[0],
    ),
  ) as Record<string, unknown>;

const hashJson = (value: unknown): Hash =>
  keccak256(stringToBytes(JSON.stringify(canonicalJson(value))));

const withoutEvidenceHash = (evidence: SimulationEvidence) => {
  return Object.fromEntries(
    Object.entries(evidence).filter(([key]) => key !== "evidenceHash"),
  );
};

/** Hash only normalized evidence fields; the supplied hash is never trusted. */
export const hashSimulationEvidence = (evidence: SimulationEvidence): Hash =>
  hashJson(withoutEvidenceHash(evidence));

/** Hash the exact executable fields that simulation evidence binds. */
export const hashExecutableCandidate = (
  executable: ExecutableTransferCandidate,
): Hash => hashJson(executable);

const validateFixture = (fixture: LocalFixtureIdentity): void => {
  if (!fixture || typeof fixture !== "object")
    throw new SimulationResolutionError("INVALID_FIXTURE");
  if (
    fixture.chainId !== LOCAL_CHAIN_ID ||
    !canonicalIdentifier(fixture.fixtureInstanceId) ||
    !canonicalAddress(fixture.walletAddress) ||
    !canonicalAddress(fixture.tokenAddress)
  ) {
    throw new SimulationResolutionError("INVALID_FIXTURE");
  }
  let url: URL;
  try {
    url = new URL(fixture.rpcUrl);
  } catch {
    throw new SimulationResolutionError("PUBLIC_RPC_FORBIDDEN");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new SimulationResolutionError("PUBLIC_RPC_FORBIDDEN");
  }
};

const validateCore = (
  verifiedCore: VerifiedTransferCore,
  fixture: LocalFixtureIdentity,
): TransferCoreCandidate => {
  if (!verifiedCore || verifiedCore.ok !== true || !verifiedCore.verified) {
    throw new SimulationResolutionError("INVALID_VERIFIED_CORE");
  }
  if (verifiedCore.verified.fixtureInstanceId !== fixture.fixtureInstanceId)
    throw new SimulationResolutionError("FIXTURE_MISMATCH");
  return verifiedCore.verified;
};

const requireCanonicalBlock = async (
  rpc: LocalReadRpc,
  number: bigint,
): Promise<CanonicalBlock> => {
  const block = await rpc.getBlockByNumber(number);
  if (!block) throw new SimulationResolutionError("MISSING_BLOCK");
  if (
    block.number !== number ||
    !canonicalHash(block.hash) ||
    block.baseFeePerGas < 0n
  ) {
    throw new SimulationResolutionError("INVALID_RPC_EVIDENCE");
  }
  const byHash = await rpc.getBlockByHash(block.hash);
  if (!byHash || byHash.number !== number || byHash.hash !== block.hash) {
    throw new SimulationResolutionError("NONCANONICAL_BLOCK");
  }
  return block;
};

const makeExpectedDelta = (
  core: TransferCoreCandidate,
): ExpectedAssetDelta => ({
  assetAddress: core.target,
  from: core.from,
  to: core.recipient,
  amountAtomic: core.amountAtomic,
});

const makeEvidence = (
  input: Omit<SimulationEvidence, "evidenceHash">,
): SimulationEvidence => {
  const evidence = {
    ...input,
    evidenceHash: "0x" + "00".repeat(32),
  } as SimulationEvidence;
  return { ...evidence, evidenceHash: hashSimulationEvidence(evidence) };
};

const revertEvidence = (input: {
  core: TransferCoreCandidate;
  fixture: LocalFixtureIdentity;
  block: CanonicalBlock;
  senderNonce: bigint;
  tokenBalance: bigint;
  nativeBalance: bigint;
  revertData?: Hex;
}): SimulationEvidence =>
  makeEvidence({
    schemaVersion: "1.0",
    fixtureInstanceId: input.fixture.fixtureInstanceId,
    chainId: LOCAL_CHAIN_ID,
    blockNumber: input.block.number.toString(),
    blockHash: input.block.hash,
    candidateHash: hashJson(input.core),
    from: input.core.from,
    to: input.core.target,
    value: "0",
    calldata: input.core.calldata,
    senderNonce: input.senderNonce.toString(),
    tokenBalance: input.tokenBalance.toString(),
    nativeBalance: input.nativeBalance.toString(),
    gasEstimate: "0",
    gasLimit: "0",
    baseFeePerGas: input.block.baseFeePerGas.toString(),
    maxPriorityFeePerGas: "0",
    maxFeePerGas: "0",
    accessList: [],
    outcome: "revert",
    revert: {
      code: "EXECUTION_REVERT",
      ...(input.revertData === undefined ? {} : { data: input.revertData }),
    },
    expectedAssetDeltas: [makeExpectedDelta(input.core)],
    maximumNativeFeeAtomic: "0",
    simulatorVersion: SIMULATOR_VERSION,
  });

const failureWithEvidence = (
  code: SimulationFailureCode,
  evidence: SimulationEvidence,
): never => {
  throw new SimulationResolutionError(code, evidence);
};

/**
 * Resolve a verified static transfer against one canonical local block.
 * The RPC is an evidence source; all authority and fee arithmetic stays here.
 */
export const simulateAndResolveTransfer = async (
  verifiedCore: VerifiedTransferCore,
  rpc: LocalReadRpc,
  fixture: LocalFixtureIdentity,
  constraints: ActiveFeeAndExecutionConstraints,
): Promise<{
  executable: ExecutableTransferCandidate;
  simulation: SuccessfulFreshSimulation;
}> => {
  validateFixture(fixture);
  const core = validateCore(verifiedCore, fixture);
  if (core.chainId !== LOCAL_CHAIN_ID || core.from !== fixture.walletAddress)
    throw new SimulationResolutionError("INVALID_VERIFIED_CORE");
  if (rpc.rpcUrl !== undefined && rpc.rpcUrl !== fixture.rpcUrl)
    throw new SimulationResolutionError("PUBLIC_RPC_FORBIDDEN");
  if (
    rpc.fixtureInstanceId !== undefined &&
    rpc.fixtureInstanceId !== fixture.fixtureInstanceId
  ) {
    throw new SimulationResolutionError("FIXTURE_MISMATCH");
  }
  if (
    !constraints ||
    typeof constraints !== "object" ||
    !isAtomic(constraints.intentMaximumNetworkFeeAtomic) ||
    !isAtomic(constraints.policyMaximumNetworkFeeAtomic)
  ) {
    throw new SimulationResolutionError("FEE_CEILING_CONFLICT");
  }

  const chainId = asBigInt(await rpc.getChainId(), "chainId");
  if (chainId !== LOCAL_CHAIN_NUMBER)
    throw new SimulationResolutionError("WRONG_CHAIN");
  const blockNumber = asBigInt(await rpc.getBlockNumber(), "blockNumber");
  const block = await requireCanonicalBlock(rpc, blockNumber);
  const senderNonce = asBigInt(
    await rpc.getPendingNonce(core.from),
    "pending nonce",
  );
  const tokenBalance = asBigInt(
    await rpc.getTokenBalance(core.target, core.from, block.number),
    "token balance",
  );
  const nativeBalance = asBigInt(
    await rpc.getNativeBalance(core.from, block.number),
    "native balance",
  );
  const request: SimulationRequest = {
    from: core.from,
    to: core.target,
    data: core.calldata,
    value: 0n,
    blockNumber: block.number,
    nonce: senderNonce,
    accessList: [],
  };
  const simulated = await rpc.simulateTransfer(request);
  if (simulated.outcome === "revert") {
    const evidence = revertEvidence({
      core,
      fixture,
      block,
      senderNonce,
      tokenBalance,
      nativeBalance,
      ...(simulated.revertData === undefined
        ? {}
        : { revertData: simulated.revertData }),
    });
    failureWithEvidence(
      tokenBalance < BigInt(core.amountAtomic)
        ? "INSUFFICIENT_TOKEN_BALANCE"
        : "SIMULATION_REVERT",
      evidence,
    );
  }
  if (simulated.outcome !== "success")
    throw new SimulationResolutionError("INVALID_RPC_EVIDENCE");
  if (tokenBalance < BigInt(core.amountAtomic)) {
    const evidence = revertEvidence({
      core,
      fixture,
      block,
      senderNonce,
      tokenBalance,
      nativeBalance,
    });
    failureWithEvidence("INSUFFICIENT_TOKEN_BALANCE", evidence);
  }

  const gasEstimate = asBigInt(await rpc.estimateGas(request), "gas estimate");
  if (gasEstimate === 0n)
    throw new SimulationResolutionError("INVALID_RPC_EVIDENCE");
  const feeData = await rpc.getFeeData(block.number);
  const baseFeePerGas = asBigInt(feeData.baseFeePerGas, "base fee");
  const maxPriorityFeePerGas = asBigInt(
    feeData.maxPriorityFeePerGas,
    "priority fee",
  );
  if (baseFeePerGas !== block.baseFeePerGas)
    throw new SimulationResolutionError("INVALID_FEE_DATA");
  const gasMargin = (gasEstimate + 9n) / 10n;
  const gasLimit = gasEstimate + (gasMargin === 0n ? 1n : gasMargin);
  const maxFeePerGas = baseFeePerGas * 2n + maxPriorityFeePerGas;
  if (maxPriorityFeePerGas > maxFeePerGas)
    throw new SimulationResolutionError("INVALID_FEE_DATA");
  const maximumNativeFeeAtomic = checkedProduct(
    gasLimit.toString(),
    maxFeePerGas.toString(),
  );
  const ceiling = minAtomic(
    constraints.intentMaximumNetworkFeeAtomic,
    constraints.policyMaximumNetworkFeeAtomic,
  );
  if (BigInt(maximumNativeFeeAtomic) > BigInt(ceiling))
    throw new SimulationResolutionError("FEE_CEILING_CONFLICT");
  if (nativeBalance < BigInt(maximumNativeFeeAtomic)) {
    const evidence = makeEvidence({
      schemaVersion: "1.0",
      fixtureInstanceId: fixture.fixtureInstanceId,
      chainId: LOCAL_CHAIN_ID,
      blockNumber: block.number.toString(),
      blockHash: block.hash,
      candidateHash: hashJson(core),
      from: core.from,
      to: core.target,
      value: "0",
      calldata: core.calldata,
      senderNonce: senderNonce.toString(),
      tokenBalance: tokenBalance.toString(),
      nativeBalance: nativeBalance.toString(),
      gasEstimate: gasEstimate.toString(),
      gasLimit: gasLimit.toString(),
      baseFeePerGas: baseFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      accessList: [],
      outcome: "success",
      expectedAssetDeltas: [makeExpectedDelta(core)],
      maximumNativeFeeAtomic,
      simulatorVersion: SIMULATOR_VERSION,
    });
    failureWithEvidence("INSUFFICIENT_NATIVE_BALANCE", evidence);
  }

  const executable: ExecutableTransferCandidate = {
    ...core,
    nonce: senderNonce.toString(),
    transactionType: "eip1559",
    gasLimit: gasLimit.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    accessList: [],
  };
  const simulation = makeEvidence({
    schemaVersion: "1.0",
    fixtureInstanceId: fixture.fixtureInstanceId,
    chainId: LOCAL_CHAIN_ID,
    blockNumber: block.number.toString(),
    blockHash: block.hash,
    candidateHash: hashExecutableCandidate(executable),
    from: executable.from,
    to: executable.target,
    value: executable.nativeValue,
    calldata: executable.calldata,
    senderNonce: executable.nonce,
    tokenBalance: tokenBalance.toString(),
    nativeBalance: nativeBalance.toString(),
    gasEstimate: gasEstimate.toString(),
    gasLimit: executable.gasLimit,
    baseFeePerGas: baseFeePerGas.toString(),
    maxPriorityFeePerGas: executable.maxPriorityFeePerGas,
    maxFeePerGas: executable.maxFeePerGas,
    accessList: [],
    outcome: "success",
    expectedAssetDeltas: [makeExpectedDelta(core)],
    maximumNativeFeeAtomic,
    simulatorVersion: SIMULATOR_VERSION,
  });
  return { executable, simulation: simulation as SuccessfulFreshSimulation };
};

const sameKeys = (value: object, keys: readonly string[]) =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);

const validEvidence = (simulation: SimulationEvidence): boolean =>
  (() => {
    try {
      if (!simulationEvidenceSchema.safeParse(simulation).success) return false;
      return (
        simulation.schemaVersion === "1.0" &&
        simulation.chainId === LOCAL_CHAIN_ID &&
        canonicalIdentifier(simulation.fixtureInstanceId) &&
        isAtomic(simulation.blockNumber) &&
        canonicalHash(simulation.blockHash) &&
        canonicalHash(simulation.candidateHash) &&
        canonicalAddress(simulation.from) &&
        canonicalAddress(simulation.to) &&
        simulation.value === "0" &&
        /^0x(?:[0-9a-f]{2})*$/.test(simulation.calldata) &&
        isAtomic(simulation.senderNonce) &&
        isAtomic(simulation.tokenBalance) &&
        isAtomic(simulation.nativeBalance) &&
        isAtomic(simulation.gasEstimate) &&
        isAtomic(simulation.gasLimit) &&
        isAtomic(simulation.baseFeePerGas) &&
        isAtomic(simulation.maxPriorityFeePerGas) &&
        isAtomic(simulation.maxFeePerGas) &&
        Array.isArray(simulation.accessList) &&
        simulation.accessList.length === 0 &&
        Array.isArray(simulation.expectedAssetDeltas) &&
        simulation.expectedAssetDeltas.every(
          (delta) =>
            canonicalAddress(delta.assetAddress) &&
            canonicalAddress(delta.from) &&
            canonicalAddress(delta.to) &&
            isAtomic(delta.amountAtomic),
        ) &&
        simulation.simulatorVersion === SIMULATOR_VERSION &&
        simulation.evidenceHash === hashSimulationEvidence(simulation)
      );
    } catch {
      return false;
    }
  })();

const failExact = (
  code: ExactVerificationFailureCode,
  field?: string,
): ExactVerificationFailure => ({
  ok: false,
  code,
  ...(field === undefined ? {} : { field }),
});

/** Verify all executable fields and every simulation binding before envelope work. */
export const verifyExecutableTransfer = (
  verifiedCore: VerifiedTransferCore,
  executable: ExecutableTransferCandidate,
  simulation: SuccessfulFreshSimulation,
  constraints: ActiveFeeAndExecutionConstraints,
): ExactVerificationResult => {
  if (!verifiedCore?.ok) return failExact("INVALID_VERIFIED_CORE");
  if (
    !executable ||
    typeof executable !== "object" ||
    !executableTransferCandidateSchema.safeParse(executable).success ||
    !sameKeys(executable, EXECUTABLE_KEYS) ||
    executable.transactionType !== "eip1559" ||
    !Array.isArray(executable.accessList) ||
    executable.accessList.length !== 0
  )
    return failExact("INVALID_EXECUTABLE");
  const coreKeys = Object.keys(verifiedCore.verified).sort();
  for (const key of coreKeys) {
    if (
      JSON.stringify(executable[key as keyof ExecutableTransferCandidate]) !==
      JSON.stringify(verifiedCore.verified[key as keyof TransferCoreCandidate])
    )
      return failExact("EXECUTABLE_CHANGED", key);
  }
  for (const field of [
    "nonce",
    "gasLimit",
    "maxPriorityFeePerGas",
    "maxFeePerGas",
  ] as const) {
    if (!isAtomic(executable[field]))
      return failExact("INVALID_EXECUTABLE", field);
  }
  if (BigInt(executable.maxPriorityFeePerGas) > BigInt(executable.maxFeePerGas))
    return failExact("PRIORITY_FEE_EXCEEDS_MAX_FEE", "maxPriorityFeePerGas");
  if (!validEvidence(simulation) || simulation.outcome !== "success")
    return failExact("SIMULATION_CHANGED");
  if (
    simulation.fixtureInstanceId !== executable.fixtureInstanceId ||
    simulation.chainId !== executable.chainId ||
    simulation.from !== executable.from ||
    simulation.to !== executable.target ||
    simulation.value !== executable.nativeValue ||
    simulation.calldata !== executable.calldata ||
    simulation.senderNonce !== executable.nonce ||
    simulation.gasLimit !== executable.gasLimit ||
    simulation.maxPriorityFeePerGas !== executable.maxPriorityFeePerGas ||
    simulation.maxFeePerGas !== executable.maxFeePerGas ||
    simulation.accessList.length !== 0 ||
    simulation.candidateHash !== hashExecutableCandidate(executable)
  )
    return failExact("SIMULATION_CHANGED");
  const expectedDelta = simulation.expectedAssetDeltas[0];
  if (
    simulation.expectedAssetDeltas.length !== 1 ||
    !expectedDelta ||
    expectedDelta.assetAddress !== executable.target ||
    expectedDelta.from !== executable.from ||
    expectedDelta.to !== executable.recipient ||
    expectedDelta.amountAtomic !== executable.amountAtomic ||
    BigInt(simulation.gasEstimate) === 0n ||
    BigInt(simulation.gasLimit) !==
      BigInt(simulation.gasEstimate) +
        ((BigInt(simulation.gasEstimate) + 9n) / 10n || 1n) ||
    BigInt(simulation.baseFeePerGas) + BigInt(simulation.maxPriorityFeePerGas) >
      BigInt(simulation.maxFeePerGas)
  )
    return failExact("SIMULATION_CHANGED");
  if (
    !isAtomic(constraints.intentMaximumNetworkFeeAtomic) ||
    !isAtomic(constraints.policyMaximumNetworkFeeAtomic)
  )
    return failExact("FEE_CEILING_CONFLICT");
  const maximumCost =
    BigInt(executable.gasLimit) * BigInt(executable.maxFeePerGas);
  const ceiling = minAtomic(
    constraints.intentMaximumNetworkFeeAtomic,
    constraints.policyMaximumNetworkFeeAtomic,
  );
  if (maximumCost > BigInt(ceiling)) return failExact("FEE_CEILING_CONFLICT");
  if (simulation.maximumNativeFeeAtomic !== maximumCost.toString())
    return failExact("SIMULATION_CHANGED", "maximumNativeFeeAtomic");
  return { ok: true, verified: executable };
};

export interface FreshnessInput {
  verifiedCore: VerifiedTransferCore;
  executable: ExecutableTransferCandidate;
  simulation: SuccessfulFreshSimulation;
  rpc: LocalReadRpc;
  fixture: LocalFixtureIdentity;
  constraints: ActiveFeeAndExecutionConstraints;
  maxBlockAge: bigint;
}

/** Check bounded pre-sign freshness; an unrelated newer head is permitted. */
export const checkSimulationFreshness = async (
  input: FreshnessInput,
): Promise<FreshnessResult> => {
  if (
    input.rpc.rpcUrl !== undefined &&
    input.rpc.rpcUrl !== input.fixture.rpcUrl
  )
    return { ok: false, code: "FIXTURE_CHANGED" };
  if (
    input.fixture.fixtureInstanceId !== input.simulation.fixtureInstanceId ||
    (input.rpc.fixtureInstanceId !== undefined &&
      input.rpc.fixtureInstanceId !== input.fixture.fixtureInstanceId)
  )
    return { ok: false, code: "FIXTURE_CHANGED" };
  if (!validEvidence(input.simulation))
    return { ok: false, code: "SIMULATION_CHANGED" };
  if ((await input.rpc.getChainId()) !== LOCAL_CHAIN_NUMBER)
    return { ok: false, code: "WRONG_CHAIN" };
  if (
    verifyExecutableTransfer(
      input.verifiedCore,
      input.executable,
      input.simulation,
      input.constraints,
    ).ok === false
  )
    return { ok: false, code: "EXECUTABLE_CHANGED" };
  const currentHead = await input.rpc.getBlockNumber();
  if (input.maxBlockAge < 0n) return { ok: false, code: "BLOCK_TOO_OLD" };
  if (currentHead < BigInt(input.simulation.blockNumber))
    return { ok: false, code: "NONCANONICAL_BLOCK" };
  if (currentHead - BigInt(input.simulation.blockNumber) > input.maxBlockAge)
    return { ok: false, code: "BLOCK_TOO_OLD" };
  const canonical = await input.rpc.getBlockByNumber(
    BigInt(input.simulation.blockNumber),
  );
  if (!canonical) return { ok: false, code: "MISSING_BLOCK" };
  const canonicalByHash = await input.rpc.getBlockByHash(
    input.simulation.blockHash,
  );
  if (
    canonical.hash !== input.simulation.blockHash ||
    !canonicalByHash ||
    canonicalByHash.number !== canonical.number ||
    canonicalByHash.hash !== canonical.hash
  )
    return { ok: false, code: "NONCANONICAL_BLOCK" };
  if (
    (await input.rpc.getPendingNonce(input.executable.from)).toString() !==
    input.simulation.senderNonce
  )
    return { ok: false, code: "NONCE_CHANGED" };
  const tokenBalance = await input.rpc.getTokenBalance(
    input.executable.target,
    input.executable.from,
    currentHead,
  );
  if (tokenBalance < BigInt(input.executable.amountAtomic))
    return { ok: false, code: "TOKEN_BALANCE_CHANGED" };
  const nativeBalance = await input.rpc.getNativeBalance(
    input.executable.from,
    currentHead,
  );
  if (nativeBalance < BigInt(input.simulation.maximumNativeFeeAtomic))
    return { ok: false, code: "NATIVE_BALANCE_CHANGED" };
  const feeData = await input.rpc.getFeeData(currentHead);
  if (
    feeData.baseFeePerGas < 0n ||
    feeData.maxPriorityFeePerGas < 0n ||
    feeData.baseFeePerGas !== canonical.baseFeePerGas
  )
    return { ok: false, code: "FEE_CEILING_CONFLICT" };
  if (
    feeData.baseFeePerGas + BigInt(input.executable.maxPriorityFeePerGas) >
    BigInt(input.executable.maxFeePerGas)
  )
    return { ok: false, code: "FEE_CEILING_CONFLICT" };
  return { ok: true, reason: "FRESH" };
};

const LOCAL_ANVIL_CHAIN = defineChain({
  id: 31337,
  name: "Crip Wallet Local Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1"] } },
});

const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

const errorData = (error: unknown): Hex | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: unknown }).data;
  return typeof data === "string" && /^0x[0-9a-f]*$/i.test(data)
    ? (data.toLowerCase() as Hex)
    : undefined;
};

/** Build the only supported production-shaped RPC adapter: loopback Anvil. */
export const createLocalAnvilReadRpc = (input: {
  rpcUrl: string;
  fixtureInstanceId: string;
}): LocalReadRpc => {
  const fixture: LocalFixtureIdentity = {
    fixtureInstanceId: input.fixtureInstanceId,
    chainId: LOCAL_CHAIN_ID,
    walletAddress: "0x0000000000000000000000000000000000000001",
    tokenAddress: "0x0000000000000000000000000000000000000001",
    rpcUrl: input.rpcUrl,
  };
  validateFixture(fixture);
  const client = createPublicClient({
    chain: LOCAL_ANVIL_CHAIN,
    transport: http(input.rpcUrl),
  });
  const block = async (number: bigint): Promise<CanonicalBlock> => {
    const value = await client.getBlock({ blockNumber: number });
    if (!value.hash || value.baseFeePerGas === null)
      throw new SimulationResolutionError("INVALID_RPC_EVIDENCE");
    return {
      number: value.number,
      hash: value.hash,
      baseFeePerGas: value.baseFeePerGas,
    };
  };
  const byHash = async (hash: Hash): Promise<CanonicalBlock | null> => {
    const value = await client.getBlock({ blockHash: hash });
    if (!value.hash || value.baseFeePerGas === null) return null;
    return {
      number: value.number,
      hash: value.hash,
      baseFeePerGas: value.baseFeePerGas,
    };
  };
  const rpcNonce = (request: SimulationRequest): number => {
    const nonce = Number(request.nonce);
    if (!Number.isSafeInteger(nonce))
      throw new SimulationResolutionError("INVALID_RPC_EVIDENCE");
    return nonce;
  };
  return {
    rpcUrl: input.rpcUrl,
    fixtureInstanceId: input.fixtureInstanceId,
    getChainId: async () => BigInt(await client.getChainId()),
    getBlockNumber: async () => BigInt(await client.getBlockNumber()),
    getBlockByNumber: async (number) => {
      try {
        return await block(number);
      } catch (error) {
        if (error instanceof Error && /not found/i.test(error.message))
          return null;
        throw error;
      }
    },
    getBlockByHash: byHash,
    getPendingNonce: async (address) =>
      BigInt(
        await client.getTransactionCount({ address, blockTag: "pending" }),
      ),
    getNativeBalance: (address, blockNumber) =>
      client.getBalance({ address, blockNumber }),
    getTokenBalance: async (tokenAddress, address, blockNumber) =>
      (await client.readContract({
        address: tokenAddress,
        abi: balanceOfAbi,
        functionName: "balanceOf",
        args: [address],
        blockNumber,
      })) as bigint,
    simulateTransfer: async (request) => {
      try {
        await client.call({
          account: request.from,
          to: request.to,
          data: request.data,
          value: request.value,
          nonce: rpcNonce(request),
          blockNumber: request.blockNumber,
        });
        return { outcome: "success" };
      } catch (error) {
        const data = errorData(error);
        return {
          outcome: "revert",
          ...(data === undefined ? {} : { revertData: data }),
        };
      }
    },
    estimateGas: (request) =>
      client.estimateGas({
        account: request.from,
        to: request.to,
        data: request.data,
        value: request.value,
        nonce: rpcNonce(request),
        blockNumber: request.blockNumber,
        accessList: [],
      }),
    getFeeData: async (blockNumber) => {
      const selected = await block(blockNumber);
      return {
        baseFeePerGas: selected.baseFeePerGas,
        maxPriorityFeePerGas: await client.estimateMaxPriorityFeePerGas(),
      };
    },
  };
};
