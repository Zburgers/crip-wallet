import { describe, expect, it } from "vitest";

import { attachEnvelopeHash, type ExecutionEnvelopeV2 } from "@crip/schemas";
import {
  verifyUntrustedChainEvidence,
  type ChainEvidenceExpectation,
  type UntrustedChainEvidence,
} from "../src/index.js";

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const token = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const transactionHash = `0x${"12".repeat(32)}` as const;
const blockHash = `0x${"34".repeat(32)}` as const;
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df523b3ef";
const topicAddress = (address: string) =>
  `0x${"0".repeat(24)}${address.slice(2)}`;
const transferData = `0x${BigInt(500000).toString(16).padStart(64, "0")}`;

const envelope = attachEnvelopeHash({
  schemaVersion: "2.0",
  envelopeId: "env_chain_001",
  revision: 1,
  intentId: "intent_chain_001",
  intentHash: `0x${"56".repeat(32)}`,
  agentId: "agent_chain_001",
  walletId: "wallet_chain_001",
  adapterId: "local-anvil",
  adapterVersion: "1.0.0",
  chainId: "eip155:31337",
  from: wallet,
  to: token,
  value: "0",
  calldata:
    "0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000007a120",
  decodedFunction: "erc20.transfer",
  decodedArguments: {
    assetAddress: token,
    recipient,
    amountAtomic: "500000",
  },
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
  policyId: "policy_chain_001",
  policyVersion: 1,
  policyDecisionHash: `0x${"bc".repeat(32)}`,
  budgetReservationId: "reservation_chain_001",
  createdAt: "2026-08-29T10:00:00Z",
  expiresAt: "2026-08-29T10:10:00Z",
  riskDecision: "ALLOW",
  approvalRequirement: "none",
  envelopeHash: `0x${"00".repeat(32)}`,
}) as ExecutionEnvelopeV2;

const expectation: ChainEvidenceExpectation = {
  operationId: "operation_chain_001",
  reservationId: "reservation_chain_001",
  envelopeId: envelope.envelopeId,
  envelopeRevision: envelope.revision,
  envelopeHash: envelope.envelopeHash as `0x${string}`,
  authorizationId: "authorization_chain_001",
  fixtureInstanceId: "fixture_chain_001",
  expectedTransactionHash: transactionHash,
  fixture: {
    fixtureInstanceId: "fixture_chain_001",
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
    input: envelope.calldata,
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
        data: transferData,
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

describe("P2-05B untrusted chain evidence verification", () => {
  const transaction = evidence.transaction as Record<string, unknown>;
  const receipt = evidence.receipt as Record<string, unknown>;
  const transferLog = (receipt.logs as readonly unknown[])[0] as Record<
    string,
    unknown
  >;

  const expectMismatch = (
    result: ReturnType<typeof verifyUntrustedChainEvidence>,
    code: string,
    field?: string,
  ) => {
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.mismatches.some(
        (item) =>
          item.code === code && (field === undefined || item.field === field),
      ),
    ).toBe(true);
  };

  it("returns normalized verified success evidence for one canonical transfer", () => {
    const result = verifyUntrustedChainEvidence(expectation, evidence);

    expect(result).toEqual({
      ok: true,
      verified: {
        operationId: expectation.operationId,
        reservationId: expectation.reservationId,
        envelopeId: expectation.envelopeId,
        envelopeRevision: expectation.envelopeRevision,
        envelopeHash: expectation.envelopeHash,
        authorizationId: expectation.authorizationId,
        fixtureInstanceId: expectation.fixture.fixtureInstanceId,
        chainId: "eip155:31337",
        transactionHash,
        blockNumber: "101",
        blockHash,
        transactionIndex: undefined,
        from: wallet,
        to: token,
        valueAtomic: "0",
        calldata: envelope.calldata,
        nonce: "7",
        transactionType: "eip1559",
        gasLimit: "55000",
        maxPriorityFeePerGas: "2",
        maxFeePerGas: "22",
        accessList: [],
        receiptStatus: "SUCCESS",
        gasUsed: "51000",
        effectiveGasPrice: "20",
        nativeFeeAtomic: "1020000",
        tokenSpendAtomic: "500000",
        transfer: {
          logIndex: "0",
          tokenAddress: token,
          from: wallet,
          to: recipient,
          amountAtomic: "500000",
        },
      },
    });
  });

  it.each([
    [
      "hash",
      { hash: `0x${"13".repeat(32)}` },
      "TRANSACTION_HASH_MISMATCH",
      "hash",
    ],
    ["from", { from: recipient }, "TRANSACTION_FROM_MISMATCH", "from"],
    ["to", { to: recipient }, "TRANSACTION_TO_MISMATCH", "to"],
    ["calldata", { input: "0x" }, "TRANSACTION_INPUT_MISMATCH", "input"],
    ["value", { value: 1n }, "TRANSACTION_VALUE_MISMATCH", "value"],
    ["nonce", { nonce: 8n }, "TRANSACTION_NONCE_MISMATCH", "nonce"],
    ["type", { type: "legacy" }, "TRANSACTION_TYPE_MISMATCH", "type"],
    ["gas", { gas: 55001n }, "TRANSACTION_GAS_MISMATCH", "gas"],
    [
      "priority fee",
      { maxPriorityFeePerGas: 3n },
      "TRANSACTION_PRIORITY_FEE_MISMATCH",
      "maxPriorityFeePerGas",
    ],
    [
      "max fee",
      { maxFeePerGas: 23n },
      "TRANSACTION_MAX_FEE_MISMATCH",
      "maxFeePerGas",
    ],
    [
      "access list",
      { accessList: [{}] },
      "TRANSACTION_ACCESS_LIST_MISMATCH",
      "accessList",
    ],
  ] as const)(
    "rejects a transaction %s mutation",
    (_name, mutation, code, field) => {
      expectMismatch(
        verifyUntrustedChainEvidence(expectation, {
          ...evidence,
          transaction: { ...transaction, ...mutation },
        }),
        code,
        field,
      );
    },
  );

  it("rejects evidence from a different current fixture instance", () => {
    const changedFixture = {
      ...expectation,
      fixture: {
        ...expectation.fixture,
        fixtureInstanceId: "fixture_chain_002",
      },
    };
    expectMismatch(
      verifyUntrustedChainEvidence(changedFixture, evidence),
      "FIXTURE_MISMATCH",
      "fixtureInstanceId",
    );
  });

  it("rejects missing receipt and non-canonical block evidence", () => {
    expectMismatch(
      verifyUntrustedChainEvidence(expectation, { ...evidence, receipt: null }),
      "RECEIPT_MISSING",
    );
    expectMismatch(
      verifyUntrustedChainEvidence(expectation, {
        ...evidence,
        canonicalBlockByHash: { number: 101n, hash: `0x${"35".repeat(32)}` },
      }),
      "CANONICAL_BLOCK_MISMATCH",
    );
  });

  it.each([
    ["missing", [], "TRANSFER_MISSING"],
    ["duplicate", [transferLog, transferLog], "TRANSFER_DUPLICATE"],
    [
      "wrong amount",
      [{ ...transferLog, data: `0x${"00".repeat(32)}` }],
      "TRANSFER_MISMATCH",
    ],
  ] as const)("rejects %s Transfer evidence", (_name, logs, code) => {
    expectMismatch(
      verifyUntrustedChainEvidence(expectation, {
        ...evidence,
        receipt: { ...receipt, logs },
      }),
      code,
    );
  });

  it("returns zero token spend for a matching reverted transaction", () => {
    const result = verifyUntrustedChainEvidence(expectation, {
      ...evidence,
      receipt: { ...receipt, status: "reverted", logs: [] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified.receiptStatus).toBe("REVERT");
    expect(result.verified.tokenSpendAtomic).toBe("0");
    expect(result.verified.nativeFeeAtomic).toBe("1020000");
    expect(result.verified.transfer).toBeUndefined();
  });

  it("fails closed for malformed RPC objects and operation substitution", () => {
    expectMismatch(
      verifyUntrustedChainEvidence(expectation, {
        ...evidence,
        transaction: { ...transaction, gas: "55000" },
      }),
      "MALFORMED_TRANSACTION",
    );
    expectMismatch(
      verifyUntrustedChainEvidence(expectation, {
        ...evidence,
        receipt: { ...receipt, logs: [{ ...transferLog, data: "0x0" }] },
      }),
      "MALFORMED_LOG",
    );
    expectMismatch(
      verifyUntrustedChainEvidence(
        { ...expectation, expectedTransactionHash: `0x${"13".repeat(32)}` },
        evidence,
      ),
      "TRANSACTION_HASH_MISMATCH",
    );
  });
});
