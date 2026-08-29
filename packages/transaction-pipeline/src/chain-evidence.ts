import {
  canonicalExecutionEnvelopeV2Schema,
  hashExecutionEnvelope,
  type ExecutionEnvelopeV2,
} from "@crip/schemas";

import { decodeTransferIndependent } from "./decode-transfer.js";
import type { Address } from "./candidate.js";
import type { LocalFixtureIdentity } from "./simulation.js";

export type ChainEvidenceHash = `0x${string}`;

/** RPC payloads are intentionally unknown until this verifier parses them. */
export interface UntrustedChainEvidence {
  transaction: unknown;
  receipt: unknown;
  canonicalBlockByNumber: unknown;
  canonicalBlockByHash: unknown;
}

/** Trusted control-plane bindings supplied by the operation/reconciliation caller. */
export interface ChainEvidenceExpectation {
  operationId: string;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: ChainEvidenceHash;
  authorizationId: string;
  fixtureInstanceId: string;
  expectedTransactionHash: ChainEvidenceHash;
  fixture: LocalFixtureIdentity;
  envelope: ExecutionEnvelopeV2;
}

export type ChainEvidenceMismatchCode =
  | "INVALID_EXPECTATION"
  | "FIXTURE_MISMATCH"
  | "ENVELOPE_INVALID"
  | "TRANSACTION_MISSING"
  | "MALFORMED_TRANSACTION"
  | "TRANSACTION_HASH_MISMATCH"
  | "TRANSACTION_CHAIN_MISMATCH"
  | "TRANSACTION_FROM_MISMATCH"
  | "TRANSACTION_TO_MISMATCH"
  | "TRANSACTION_INPUT_MISMATCH"
  | "TRANSACTION_VALUE_MISMATCH"
  | "TRANSACTION_NONCE_MISMATCH"
  | "TRANSACTION_TYPE_MISMATCH"
  | "TRANSACTION_GAS_MISMATCH"
  | "TRANSACTION_PRIORITY_FEE_MISMATCH"
  | "TRANSACTION_MAX_FEE_MISMATCH"
  | "TRANSACTION_ACCESS_LIST_MISMATCH"
  | "TRANSACTION_BLOCK_MISMATCH"
  | "RECEIPT_MISSING"
  | "MALFORMED_RECEIPT"
  | "RECEIPT_HASH_MISMATCH"
  | "RECEIPT_BLOCK_MISMATCH"
  | "RECEIPT_STATUS_INVALID"
  | "RECEIPT_GAS_INVALID"
  | "RECEIPT_LOG_COUNT_MISMATCH"
  | "CANONICAL_BLOCK_MISSING"
  | "MALFORMED_BLOCK"
  | "CANONICAL_BLOCK_MISMATCH"
  | "MALFORMED_LOG"
  | "REVERTED_RECEIPT_HAS_LOGS"
  | "TRANSFER_MISSING"
  | "TRANSFER_DUPLICATE"
  | "TRANSFER_MALFORMED"
  | "UNEXPECTED_LOG"
  | "TRANSFER_MISMATCH";

export interface ChainEvidenceMismatch {
  code: ChainEvidenceMismatchCode;
  source:
    "expectation" | "fixture" | "transaction" | "receipt" | "block" | "log";
  field?: string;
}

export interface VerifiedTransferLogEvidence {
  logIndex: string;
  tokenAddress: Address;
  from: Address;
  to: Address;
  amountAtomic: string;
}

/** Normalized chain evidence; this value is evidence, not reconciler authority. */
export interface VerifiedChainEvidence {
  operationId: string;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: ChainEvidenceHash;
  authorizationId: string;
  fixtureInstanceId: string;
  chainId: "eip155:31337";
  transactionHash: ChainEvidenceHash;
  blockNumber: string;
  blockHash: ChainEvidenceHash;
  transactionIndex: string | undefined;
  from: Address;
  to: Address;
  valueAtomic: string;
  calldata: `0x${string}`;
  nonce: string;
  transactionType: "eip1559";
  gasLimit: string;
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
  accessList: readonly [];
  receiptStatus: "SUCCESS" | "REVERT";
  gasUsed: string;
  effectiveGasPrice: string;
  nativeFeeAtomic: string;
  tokenSpendAtomic: string;
  transfer: VerifiedTransferLogEvidence | undefined;
}

export type ChainEvidenceVerificationResult =
  | { ok: true; verified: VerifiedChainEvidence }
  | { ok: false; mismatches: readonly ChainEvidenceMismatch[] };

type RecordValue = Record<string, unknown>;
type ParsedTransaction = {
  hash: ChainEvidenceHash;
  chainId: bigint;
  blockHash: ChainEvidenceHash;
  blockNumber: bigint;
  transactionIndex: bigint | undefined;
  from: Address;
  to: Address;
  value: bigint;
  input: `0x${string}`;
  nonce: bigint;
  type: string;
  gas: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  accessList: readonly unknown[];
};
type ParsedReceipt = {
  transactionHash: ChainEvidenceHash;
  blockHash: ChainEvidenceHash;
  blockNumber: bigint;
  status: string;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  logs: readonly ParsedLog[];
  malformedLog: boolean;
};
type ParsedBlock = { number: bigint; hash: ChainEvidenceHash };
type ParsedLog = {
  address: Address;
  topics: readonly ChainEvidenceHash[];
  data: `0x${string}`;
  logIndex: bigint;
  transactionHash: ChainEvidenceHash;
  blockHash: ChainEvidenceHash;
  blockNumber: bigint;
  removed: boolean;
};

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const HEX_BYTES_PATTERN = /^0x(?:[0-9a-f]{2})*$/;
const TOPIC_PATTERN = HASH_PATTERN;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRANSFER_EVENT_SIGNATURE =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df523b3ef" as const;
const LOCAL_CHAIN_NUMBER = 31337n;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isHash = (value: unknown): value is ChainEvidenceHash =>
  typeof value === "string" && HASH_PATTERN.test(value);
const isAddress = (value: unknown): value is Address =>
  typeof value === "string" && ADDRESS_PATTERN.test(value);
const isHexBytes = (value: unknown): value is `0x${string}` =>
  typeof value === "string" && HEX_BYTES_PATTERN.test(value);
const isAtomicBigInt = (value: unknown): value is bigint =>
  typeof value === "bigint" && value >= 0n;
const isTopic = (value: unknown): value is ChainEvidenceHash =>
  typeof value === "string" && TOPIC_PATTERN.test(value);
const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" && IDENTIFIER_PATTERN.test(value);

const mismatch = (
  code: ChainEvidenceMismatchCode,
  source: ChainEvidenceMismatch["source"],
  field?: string,
): ChainEvidenceMismatch => ({
  code,
  source,
  ...(field === undefined ? {} : { field }),
});

const parseTransaction = (value: unknown): ParsedTransaction | null => {
  if (!isRecord(value)) return null;
  const accessList = value.accessList;
  const transactionIndex = value.transactionIndex;
  if (
    !isHash(value.hash) ||
    !isAtomicBigInt(value.chainId) ||
    !isHash(value.blockHash) ||
    !isAtomicBigInt(value.blockNumber) ||
    (transactionIndex !== undefined && !isAtomicBigInt(transactionIndex)) ||
    !isAddress(value.from) ||
    !isAddress(value.to) ||
    !isAtomicBigInt(value.value) ||
    !isHexBytes(value.input) ||
    !isAtomicBigInt(value.nonce) ||
    typeof value.type !== "string" ||
    !isAtomicBigInt(value.gas) ||
    !isAtomicBigInt(value.maxPriorityFeePerGas) ||
    !isAtomicBigInt(value.maxFeePerGas) ||
    !Array.isArray(accessList)
  )
    return null;
  return {
    hash: value.hash,
    chainId: value.chainId,
    blockHash: value.blockHash,
    blockNumber: value.blockNumber,
    transactionIndex,
    from: value.from,
    to: value.to,
    value: value.value,
    input: value.input,
    nonce: value.nonce,
    type: value.type,
    gas: value.gas,
    maxPriorityFeePerGas: value.maxPriorityFeePerGas,
    maxFeePerGas: value.maxFeePerGas,
    accessList,
  };
};

const parseReceipt = (value: unknown): ParsedReceipt | null => {
  if (!isRecord(value) || !Array.isArray(value.logs)) return null;
  if (
    !isHash(value.transactionHash) ||
    !isHash(value.blockHash) ||
    !isAtomicBigInt(value.blockNumber) ||
    typeof value.status !== "string" ||
    !isAtomicBigInt(value.gasUsed) ||
    !isAtomicBigInt(value.effectiveGasPrice)
  )
    return null;
  const logs = value.logs.map(parseLog);
  return {
    transactionHash: value.transactionHash,
    blockHash: value.blockHash,
    blockNumber: value.blockNumber,
    status: value.status,
    gasUsed: value.gasUsed,
    effectiveGasPrice: value.effectiveGasPrice,
    logs: logs.filter((log): log is ParsedLog => log !== null),
    malformedLog: logs.some((log) => log === null),
  };
};

const parseLog = (value: unknown): ParsedLog | null => {
  if (!isRecord(value) || !Array.isArray(value.topics)) return null;
  const transactionHash = value.transactionHash;
  const blockHash = value.blockHash;
  const blockNumber = value.blockNumber;
  if (
    !isAddress(value.address) ||
    !value.topics.every(isTopic) ||
    !isHexBytes(value.data) ||
    !isAtomicBigInt(value.logIndex) ||
    !isHash(transactionHash) ||
    !isHash(blockHash) ||
    !isAtomicBigInt(blockNumber) ||
    typeof value.removed !== "boolean"
  )
    return null;
  return {
    address: value.address,
    topics: value.topics,
    data: value.data,
    logIndex: value.logIndex,
    transactionHash,
    blockHash,
    blockNumber,
    removed: value.removed,
  };
};

const parseBlock = (value: unknown): ParsedBlock | null => {
  if (!isRecord(value) || !isAtomicBigInt(value.number) || !isHash(value.hash))
    return null;
  return { number: value.number, hash: value.hash };
};

const topicAddress = (topic: ChainEvidenceHash): Address | null => {
  if (!topic.startsWith("0x" + "0".repeat(24))) return null;
  const address = `0x${topic.slice(26)}`;
  return isAddress(address) ? address : null;
};

const transferFromLog = (
  log: ParsedLog,
): VerifiedTransferLogEvidence | null => {
  if (log.topics[0] !== TRANSFER_EVENT_SIGNATURE) return null;
  if (log.topics.length !== 3 || log.data.length !== 66) return null;
  const from = topicAddress(log.topics[1] as ChainEvidenceHash);
  const to = topicAddress(log.topics[2] as ChainEvidenceHash);
  if (!from || !to || !/^0x[0-9a-f]{64}$/.test(log.data)) return null;
  return {
    logIndex: log.logIndex.toString(),
    tokenAddress: log.address,
    from,
    to,
    amountAtomic: BigInt(log.data).toString(),
  };
};

const validExpectationShape = (
  expectation: ChainEvidenceExpectation,
): boolean => {
  if (
    !expectation ||
    typeof expectation !== "object" ||
    !isIdentifier(expectation.operationId) ||
    !isIdentifier(expectation.reservationId) ||
    !isIdentifier(expectation.envelopeId) ||
    !Number.isSafeInteger(expectation.envelopeRevision) ||
    expectation.envelopeRevision <= 0 ||
    !isIdentifier(expectation.authorizationId) ||
    !isIdentifier(expectation.fixtureInstanceId) ||
    !isHash(expectation.envelopeHash) ||
    !isHash(expectation.expectedTransactionHash) ||
    !expectation.fixture ||
    typeof expectation.fixture !== "object" ||
    !isIdentifier(expectation.fixture.fixtureInstanceId) ||
    expectation.fixture.chainId !== "eip155:31337" ||
    !isAddress(expectation.fixture.walletAddress) ||
    !isAddress(expectation.fixture.tokenAddress) ||
    typeof expectation.fixture.rpcUrl !== "string"
  )
    return false;

  let rpcUrl: URL;
  try {
    rpcUrl = new URL(expectation.fixture.rpcUrl);
  } catch {
    return false;
  }
  if (
    rpcUrl.protocol !== "http:" ||
    rpcUrl.hostname !== "127.0.0.1" ||
    rpcUrl.username ||
    rpcUrl.password ||
    rpcUrl.pathname !== "/" ||
    rpcUrl.search ||
    rpcUrl.hash
  )
    return false;

  return true;
};

const validEnvelopeBinding = (
  expectation: ChainEvidenceExpectation,
): boolean => {
  if (
    !canonicalExecutionEnvelopeV2Schema.safeParse(expectation.envelope).success
  )
    return false;
  const envelope = expectation.envelope;
  if (
    expectation.envelopeId !== envelope.envelopeId ||
    expectation.envelopeRevision !== envelope.revision ||
    expectation.envelopeHash !== envelope.envelopeHash ||
    expectation.reservationId !== envelope.budgetReservationId ||
    hashExecutionEnvelope(envelope) !== envelope.envelopeHash ||
    envelope.from !== expectation.fixture.walletAddress ||
    envelope.to !== expectation.fixture.tokenAddress ||
    envelope.value !== "0" ||
    envelope.expectedAssetDeltas.length !== 1 ||
    envelope.expectedAssetDeltas[0]?.assetAddress !== envelope.to ||
    envelope.expectedAssetDeltas[0]?.from !== envelope.from ||
    envelope.expectedAssetDeltas[0]?.to !==
      envelope.decodedArguments.recipient ||
    envelope.expectedAssetDeltas[0]?.amountAtomic !==
      envelope.decodedArguments.amountAtomic
  )
    return false;
  const decoded = decodeTransferIndependent(envelope.calldata);
  return (
    decoded.ok &&
    decoded.recipient === envelope.decodedArguments.recipient &&
    decoded.amountAtomic === envelope.decodedArguments.amountAtomic
  );
};

const expectationMismatches = (
  expectation: ChainEvidenceExpectation,
): ChainEvidenceMismatch[] => {
  if (!validExpectationShape(expectation)) {
    return [mismatch("INVALID_EXPECTATION", "expectation")];
  }
  if (!validEnvelopeBinding(expectation))
    return [mismatch("ENVELOPE_INVALID", "expectation", "envelope")];
  return [];
};

/**
 * Independently verify untrusted local-chain transaction, receipt, block and
 * ERC-20 Transfer evidence against the current v2 execution authority.
 *
 * This function only returns evidence. It does not authenticate a reconciler,
 * write persistence, change lifecycle state, or mutate economic balances.
 */
export const verifyUntrustedChainEvidence = (
  expectation: ChainEvidenceExpectation,
  evidence: UntrustedChainEvidence,
): ChainEvidenceVerificationResult => {
  const mismatches = expectationMismatches(expectation);
  if (mismatches.length > 0) return { ok: false, mismatches };

  const issues: ChainEvidenceMismatch[] = [];
  if (expectation.fixture.fixtureInstanceId !== expectation.fixtureInstanceId)
    issues.push(mismatch("FIXTURE_MISMATCH", "fixture", "fixtureInstanceId"));
  const tx = evidence?.transaction;
  const receipt = evidence?.receipt;
  if (tx === null || tx === undefined) {
    issues.push(mismatch("TRANSACTION_MISSING", "transaction"));
  }
  if (receipt === null || receipt === undefined) {
    issues.push(mismatch("RECEIPT_MISSING", "receipt"));
  }
  const parsedTx = parseTransaction(tx);
  const parsedReceipt = parseReceipt(receipt);
  if (tx !== null && tx !== undefined && !parsedTx)
    issues.push(mismatch("MALFORMED_TRANSACTION", "transaction"));
  if (receipt !== null && receipt !== undefined && !parsedReceipt)
    issues.push(mismatch("MALFORMED_RECEIPT", "receipt"));
  if (parsedReceipt?.malformedLog)
    issues.push(mismatch("MALFORMED_LOG", "log"));

  const blockByNumber = evidence
    ? parseBlock(evidence.canonicalBlockByNumber)
    : null;
  const blockByHash = evidence
    ? parseBlock(evidence.canonicalBlockByHash)
    : null;
  if (
    evidence?.canonicalBlockByNumber === null ||
    evidence?.canonicalBlockByNumber === undefined
  )
    issues.push(mismatch("CANONICAL_BLOCK_MISSING", "block", "byNumber"));
  else if (!blockByNumber)
    issues.push(mismatch("MALFORMED_BLOCK", "block", "byNumber"));
  if (
    evidence?.canonicalBlockByHash === null ||
    evidence?.canonicalBlockByHash === undefined
  )
    issues.push(mismatch("CANONICAL_BLOCK_MISSING", "block", "byHash"));
  else if (!blockByHash)
    issues.push(mismatch("MALFORMED_BLOCK", "block", "byHash"));

  if (!parsedTx || !parsedReceipt || !blockByNumber || !blockByHash)
    return { ok: false, mismatches: issues };

  const envelope = expectation.envelope;
  if (parsedTx.hash !== expectation.expectedTransactionHash)
    issues.push(mismatch("TRANSACTION_HASH_MISMATCH", "transaction", "hash"));
  if (parsedTx.chainId !== LOCAL_CHAIN_NUMBER)
    issues.push(
      mismatch("TRANSACTION_CHAIN_MISMATCH", "transaction", "chainId"),
    );
  if (parsedTx.from !== envelope.from)
    issues.push(mismatch("TRANSACTION_FROM_MISMATCH", "transaction", "from"));
  if (parsedTx.to !== envelope.to)
    issues.push(mismatch("TRANSACTION_TO_MISMATCH", "transaction", "to"));
  if (parsedTx.input !== envelope.calldata)
    issues.push(mismatch("TRANSACTION_INPUT_MISMATCH", "transaction", "input"));
  if (parsedTx.value !== BigInt(envelope.value))
    issues.push(mismatch("TRANSACTION_VALUE_MISMATCH", "transaction", "value"));
  if (parsedTx.nonce !== BigInt(envelope.nonce))
    issues.push(mismatch("TRANSACTION_NONCE_MISMATCH", "transaction", "nonce"));
  if (parsedTx.type !== envelope.transactionType)
    issues.push(mismatch("TRANSACTION_TYPE_MISMATCH", "transaction", "type"));
  if (parsedTx.gas !== BigInt(envelope.gasLimit))
    issues.push(mismatch("TRANSACTION_GAS_MISMATCH", "transaction", "gas"));
  if (parsedTx.maxPriorityFeePerGas !== BigInt(envelope.maxPriorityFeePerGas))
    issues.push(
      mismatch(
        "TRANSACTION_PRIORITY_FEE_MISMATCH",
        "transaction",
        "maxPriorityFeePerGas",
      ),
    );
  if (
    parsedTx.maxFeePerGas !==
    BigInt(envelope.maximumFeeConstraints.maxFeePerGas)
  )
    issues.push(
      mismatch("TRANSACTION_MAX_FEE_MISMATCH", "transaction", "maxFeePerGas"),
    );
  if (parsedTx.accessList.length !== 0)
    issues.push(
      mismatch("TRANSACTION_ACCESS_LIST_MISMATCH", "transaction", "accessList"),
    );

  if (
    parsedTx.blockNumber !== blockByNumber.number ||
    parsedTx.blockHash !== blockByNumber.hash
  )
    issues.push(mismatch("TRANSACTION_BLOCK_MISMATCH", "transaction", "block"));
  if (
    blockByNumber.number !== blockByHash.number ||
    blockByNumber.hash !== blockByHash.hash
  )
    issues.push(mismatch("CANONICAL_BLOCK_MISMATCH", "block"));
  if (
    parsedReceipt.transactionHash !== parsedTx.hash ||
    parsedReceipt.transactionHash !== expectation.expectedTransactionHash
  )
    issues.push(
      mismatch("RECEIPT_HASH_MISMATCH", "receipt", "transactionHash"),
    );
  if (
    parsedReceipt.blockNumber !== parsedTx.blockNumber ||
    parsedReceipt.blockHash !== parsedTx.blockHash
  )
    issues.push(mismatch("RECEIPT_BLOCK_MISMATCH", "receipt", "block"));
  if (parsedReceipt.gasUsed > parsedTx.gas)
    issues.push(mismatch("RECEIPT_GAS_INVALID", "receipt", "gasUsed"));
  if (parsedReceipt.status !== "success" && parsedReceipt.status !== "reverted")
    issues.push(mismatch("RECEIPT_STATUS_INVALID", "receipt", "status"));

  const status = parsedReceipt.status;
  const transferLogs = parsedReceipt.logs.filter(
    (log) => log.topics[0] === TRANSFER_EVENT_SIGNATURE,
  );
  let transfer: VerifiedTransferLogEvidence | undefined;
  if (status === "reverted") {
    if (parsedReceipt.logs.length !== 0)
      issues.push(mismatch("REVERTED_RECEIPT_HAS_LOGS", "receipt", "logs"));
  } else if (status === "success") {
    if (transferLogs.length === 0) {
      issues.push(mismatch("TRANSFER_MISSING", "log"));
    } else if (transferLogs.length > 1) {
      issues.push(mismatch("TRANSFER_DUPLICATE", "log"));
    } else {
      transfer = transferFromLog(transferLogs[0] as ParsedLog) ?? undefined;
      if (!transfer) issues.push(mismatch("TRANSFER_MALFORMED", "log"));
      if (parsedReceipt.logs.length !== 1)
        issues.push(mismatch("UNEXPECTED_LOG", "receipt", "logs"));
    }
    if (parsedReceipt.logs.length === 0)
      issues.push(mismatch("RECEIPT_LOG_COUNT_MISMATCH", "receipt", "logs"));
  }

  const otherLogs = parsedReceipt.logs.filter(
    (log) => log.topics[0] !== TRANSFER_EVENT_SIGNATURE,
  );
  if (status === "success" && otherLogs.length > 0)
    issues.push(mismatch("UNEXPECTED_LOG", "log"));

  if (transfer) {
    if (transfer.tokenAddress !== envelope.to)
      issues.push(mismatch("TRANSFER_MISMATCH", "log", "tokenAddress"));
    if (transfer.from !== envelope.from)
      issues.push(mismatch("TRANSFER_MISMATCH", "log", "from"));
    if (transfer.to !== envelope.decodedArguments.recipient)
      issues.push(mismatch("TRANSFER_MISMATCH", "log", "to"));
    if (transfer.amountAtomic !== envelope.decodedArguments.amountAtomic)
      issues.push(mismatch("TRANSFER_MISMATCH", "log", "amountAtomic"));
  }
  for (const log of parsedReceipt.logs) {
    if (log.removed)
      issues.push(mismatch("TRANSFER_MISMATCH", "log", "removed"));
    if (
      log.transactionHash !== undefined &&
      log.transactionHash !== parsedTx.hash
    )
      issues.push(mismatch("TRANSFER_MISMATCH", "log", "transactionHash"));
    if (log.blockHash !== undefined && log.blockHash !== parsedTx.blockHash)
      issues.push(mismatch("TRANSFER_MISMATCH", "log", "blockHash"));
    if (
      log.blockNumber !== undefined &&
      log.blockNumber !== parsedTx.blockNumber
    )
      issues.push(mismatch("TRANSFER_MISMATCH", "log", "blockNumber"));
  }

  if (issues.length > 0) return { ok: false, mismatches: issues };
  const receiptStatus = status === "success" ? "SUCCESS" : "REVERT";
  const nativeFeeAtomic = (
    parsedReceipt.gasUsed * parsedReceipt.effectiveGasPrice
  ).toString();
  return {
    ok: true,
    verified: {
      operationId: expectation.operationId,
      reservationId: expectation.reservationId,
      envelopeId: expectation.envelopeId,
      envelopeRevision: expectation.envelopeRevision,
      envelopeHash: expectation.envelopeHash,
      authorizationId: expectation.authorizationId,
      fixtureInstanceId: expectation.fixtureInstanceId,
      chainId: "eip155:31337",
      transactionHash: parsedTx.hash,
      blockNumber: parsedTx.blockNumber.toString(),
      blockHash: parsedTx.blockHash,
      transactionIndex: parsedTx.transactionIndex?.toString(),
      from: parsedTx.from,
      to: parsedTx.to,
      valueAtomic: parsedTx.value.toString(),
      calldata: parsedTx.input,
      nonce: parsedTx.nonce.toString(),
      transactionType: "eip1559",
      gasLimit: parsedTx.gas.toString(),
      maxPriorityFeePerGas: parsedTx.maxPriorityFeePerGas.toString(),
      maxFeePerGas: parsedTx.maxFeePerGas.toString(),
      accessList: [],
      receiptStatus,
      gasUsed: parsedReceipt.gasUsed.toString(),
      effectiveGasPrice: parsedReceipt.effectiveGasPrice.toString(),
      nativeFeeAtomic,
      tokenSpendAtomic:
        receiptStatus === "SUCCESS"
          ? envelope.decodedArguments.amountAtomic
          : "0",
      transfer,
    },
  };
};
