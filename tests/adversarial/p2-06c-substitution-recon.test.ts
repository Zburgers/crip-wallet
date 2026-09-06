import { describe, expect, it } from "vitest";

import {
  attachEnvelopeHash,
  canonicalExecutionEnvelopeV2Schema,
  createEnvelopeApprovalBinding,
  isEnvelopeApprovalBound,
  type ExecutionEnvelopeV2,
} from "@crip/schemas";
import {
  verifyUntrustedChainEvidence,
  type ChainEvidenceExpectation,
  type UntrustedChainEvidence,
} from "@crip/transaction-pipeline";

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const token = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const transactionHash = `0x${"12".repeat(32)}` as const;
const blockHash = `0x${"34".repeat(32)}` as const;
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topicAddress = (address: string) =>
  `0x${"0".repeat(24)}${address.slice(2)}`;
const calldata =
  "0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000007a120";

const envelope = attachEnvelopeHash({
  schemaVersion: "2.0",
  envelopeId: "env_p206c_001",
  revision: 1,
  intentId: "intent_p206c_001",
  intentHash: `0x${"56".repeat(32)}`,
  agentId: "agent_p206c_001",
  walletId: "wallet_p206c_001",
  adapterId: "local-anvil",
  adapterVersion: "1.0.0",
  chainId: "eip155:31337",
  from: wallet,
  to: token,
  value: "0",
  calldata,
  decodedFunction: "erc20.transfer",
  decodedArguments: { assetAddress: token, recipient, amountAtomic: "500000" },
  expectedAssetDeltas: [
    {
      assetAddress: token,
      from: wallet,
      to: recipient,
      amountAtomic: "500000",
    },
  ],
  simulationBlockNumber: "100",
  simulationBlockHash: `0x${"78".repeat(32)}`,
  simulationResultHash: `0x${"9a".repeat(32)}`,
  nonceStrategy: "pending",
  nonce: "7",
  transactionType: "eip1559",
  gasLimit: "55000",
  maxPriorityFeePerGas: "2",
  accessList: [],
  maximumFeeConstraints: {
    asset: "native",
    maxFeePerGas: "22",
    maximumNetworkFeeAtomic: "1210000",
  },
  policyId: "policy_p206c_001",
  policyVersion: 1,
  policyDecisionHash: `0x${"bc".repeat(32)}`,
  budgetReservationId: "reservation_p206c_001",
  createdAt: "2026-08-29T10:00:00Z",
  expiresAt: "2026-08-29T10:10:00Z",
  riskDecision: "ALLOW",
  approvalRequirement: "none",
  envelopeHash: `0x${"00".repeat(32)}`,
}) as ExecutionEnvelopeV2;

const expectation: ChainEvidenceExpectation = {
  operationId: "operation_p206c_001",
  reservationId: envelope.budgetReservationId,
  envelopeId: envelope.envelopeId,
  envelopeRevision: envelope.revision,
  envelopeHash: envelope.envelopeHash as `0x${string}`,
  authorizationId: "authorization_p206c_001",
  fixtureInstanceId: "fixture_p206c_001",
  expectedTransactionHash: transactionHash,
  fixture: {
    fixtureInstanceId: "fixture_p206c_001",
    chainId: "eip155:31337",
    walletAddress: wallet,
    tokenAddress: token,
    rpcUrl: "http://127.0.0.1:8545/",
  },
  envelope,
};

const evidence: UntrustedChainEvidence = {
  transaction: {
    hash: transactionHash,
    chainId: 31337n,
    blockHash,
    blockNumber: 101n,
    from: wallet,
    to: token,
    value: 0n,
    input: calldata,
    nonce: 7n,
    type: "eip1559",
    gas: 55000n,
    maxPriorityFeePerGas: 2n,
    maxFeePerGas: 22n,
    accessList: [],
  },
  receipt: {
    transactionHash,
    blockHash,
    blockNumber: 101n,
    status: "success",
    gasUsed: 51000n,
    effectiveGasPrice: 20n,
    logs: [
      {
        address: token,
        topics: [transferTopic, topicAddress(wallet), topicAddress(recipient)],
        data: `0x${BigInt(500000).toString(16).padStart(64, "0")}`,
        logIndex: 0n,
        transactionHash,
        blockHash,
        blockNumber: 101n,
        removed: false,
      },
    ],
  },
  canonicalBlockByNumber: { number: 101n, hash: blockHash },
  canonicalBlockByHash: { number: 101n, hash: blockHash },
};

const transaction = evidence.transaction as Record<string, unknown>;
const receipt = evidence.receipt as Record<string, unknown>;
const transfer = (receipt.logs as readonly unknown[])[0] as Record<
  string,
  unknown
>;

const mutationFields = [
  ["chainId", { chainId: "eip155:1" }],
  ["from", { from: recipient }],
  ["to", { to: recipient }],
  ["value", { value: "1" }],
  ["calldata", { calldata: "0x" }],
  ["decodedFunction", { decodedFunction: "erc20.approve" }],
  [
    "decodedArguments",
    {
      decodedArguments: {
        ...envelope.decodedArguments,
        amountAtomic: "500001",
      },
    },
  ],
  [
    "expectedAssetDeltas",
    {
      expectedAssetDeltas: [
        { ...envelope.expectedAssetDeltas[0], amountAtomic: "500001" },
      ],
    },
  ],
  ["simulationBlockNumber", { simulationBlockNumber: "101" }],
  ["simulationBlockHash", { simulationBlockHash: `0x${"79".repeat(32)}` }],
  ["simulationResultHash", { simulationResultHash: `0x${"9b".repeat(32)}` }],
  ["nonceStrategy", { nonceStrategy: "explicit" }],
  ["nonce", { nonce: "8" }],
  ["transactionType", { transactionType: "legacy" }],
  ["gasLimit", { gasLimit: "55001" }],
  ["maxPriorityFeePerGas", { maxPriorityFeePerGas: "3" }],
  ["accessList", { accessList: [{ address: wallet, storageKeys: [] }] }],
  [
    "maxFeePerGas",
    {
      maximumFeeConstraints: {
        ...envelope.maximumFeeConstraints,
        maxFeePerGas: "23",
      },
    },
  ],
  [
    "maximumNetworkFeeAtomic",
    {
      maximumFeeConstraints: {
        ...envelope.maximumFeeConstraints,
        maximumNetworkFeeAtomic: "1210001",
      },
    },
  ],
] as const;

describe("P2-06C substitution and reconciliation adversarial coverage", () => {
  it.each(mutationFields)(
    "rejects independent envelope-v2 executable mutation: %s before signing",
    (_field, mutation) => {
      const mutated = { ...envelope, ...mutation };

      expect(
        canonicalExecutionEnvelopeV2Schema.safeParse(mutated).success,
      ).toBe(
        _field !== "chainId" &&
          _field !== "transactionType" &&
          _field !== "accessList" &&
          _field !== "decodedFunction",
      );
      expect(
        isEnvelopeApprovalBound(
          createEnvelopeApprovalBinding(envelope),
          mutated,
        ),
      ).toBe(false);
    },
  );

  it.each([
    [
      "wrong expected transaction hash",
      { hash: `0x${"13".repeat(32)}` },
      "TRANSACTION_HASH_MISMATCH",
    ],
    ["wrong from", { from: recipient }, "TRANSACTION_FROM_MISMATCH"],
    ["wrong token target", { to: recipient }, "TRANSACTION_TO_MISMATCH"],
    ["wrong recipient calldata", { input: "0x" }, "TRANSACTION_INPUT_MISMATCH"],
    ["wrong native value", { value: 1n }, "TRANSACTION_VALUE_MISMATCH"],
    ["wrong nonce", { nonce: 8n }, "TRANSACTION_NONCE_MISMATCH"],
    ["wrong transaction type", { type: "legacy" }, "TRANSACTION_TYPE_MISMATCH"],
    ["wrong gas limit", { gas: 55001n }, "TRANSACTION_GAS_MISMATCH"],
    [
      "wrong priority fee",
      { maxPriorityFeePerGas: 3n },
      "TRANSACTION_PRIORITY_FEE_MISMATCH",
    ],
    ["wrong max fee", { maxFeePerGas: 23n }, "TRANSACTION_MAX_FEE_MISMATCH"],
    [
      "mutated access list",
      { accessList: [{}] },
      "TRANSACTION_ACCESS_LIST_MISMATCH",
    ],
    ["wrong chain", { chainId: 1n }, "TRANSACTION_CHAIN_MISMATCH"],
  ] as const)(
    "rejects untrusted transaction %s before reconciliation",
    (_name, mutation, code) => {
      const result = verifyUntrustedChainEvidence(expectation, {
        ...evidence,
        transaction: { ...transaction, ...mutation },
      });

      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.mismatches.map(({ code: actual }) => actual)).toContain(
          code,
        );
    },
  );

  it.each([
    [
      "wrong receipt hash",
      { transactionHash: `0x${"13".repeat(32)}` },
      "RECEIPT_HASH_MISMATCH",
    ],
    [
      "wrong receipt block",
      { blockHash: `0x${"35".repeat(32)}` },
      "RECEIPT_BLOCK_MISMATCH",
    ],
    [
      "removed log",
      { logs: [{ ...transfer, removed: true }] },
      "TRANSFER_MISMATCH",
    ],
    [
      "wrong log token",
      { logs: [{ ...transfer, address: recipient }] },
      "TRANSFER_MISMATCH",
    ],
    [
      "wrong log sender",
      {
        logs: [
          {
            ...transfer,
            topics: [
              transferTopic,
              topicAddress(recipient),
              topicAddress(recipient),
            ],
          },
        ],
      },
      "TRANSFER_MISMATCH",
    ],
    [
      "wrong log recipient",
      {
        logs: [
          {
            ...transfer,
            topics: [transferTopic, topicAddress(wallet), topicAddress(wallet)],
          },
        ],
      },
      "TRANSFER_MISMATCH",
    ],
    [
      "wrong log amount",
      { logs: [{ ...transfer, data: `0x${"00".repeat(32)}` }] },
      "TRANSFER_MISMATCH",
    ],
    [
      "duplicate Transfer log",
      { logs: [transfer, transfer] },
      "TRANSFER_DUPLICATE",
    ],
    ["missing Transfer log", { logs: [] }, "TRANSFER_MISSING"],
  ] as const)(
    "rejects untrusted receipt/log %s before economic mutation",
    (_name, mutation, code) => {
      const result = verifyUntrustedChainEvidence(expectation, {
        ...evidence,
        receipt: { ...receipt, ...mutation },
      });

      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.mismatches.map(({ code: actual }) => actual)).toContain(
          code,
        );
    },
  );

  it("rejects cross-block and cross-evidence bindings before reconciliation", () => {
    const result = verifyUntrustedChainEvidence(expectation, {
      ...evidence,
      canonicalBlockByHash: { number: 101n, hash: `0x${"35".repeat(32)}` },
    });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.mismatches.map(({ code }) => code)).toContain(
        "CANONICAL_BLOCK_MISMATCH",
      );
  });
});
