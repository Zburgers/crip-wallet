import { describe, expect, it } from "vitest";

import {
  executableTransferCandidateSchema,
  simulationEvidenceSchema,
} from "../src/index.js";

const candidate = {
  action: "asset.transfer",
  chainId: "eip155:31337",
  from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  target: "0x1111111111111111111111111111111111111111",
  nativeValue: "0",
  calldata:
    "0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000007a120",
  selector: "0xa9059cbb",
  recipient: "0x2222222222222222222222222222222222222222",
  amountAtomic: "500000",
  nonceStrategy: "pending",
  fixtureInstanceId: "fixture-local-003",
  provenance: {
    intentId: "int_local_003",
    agentId: "agent_local_01",
    walletId: "wallet_local_01",
  },
  nonce: "3",
  transactionType: "eip1559",
  gasLimit: "55000",
  maxPriorityFeePerGas: "2",
  maxFeePerGas: "22",
  accessList: [],
} as const;

const evidence = {
  schemaVersion: "1.0",
  fixtureInstanceId: "fixture-local-003",
  chainId: "eip155:31337",
  blockNumber: "100",
  blockHash: `0x${"ab".repeat(32)}`,
  candidateHash: `0x${"cd".repeat(32)}`,
  from: candidate.from,
  to: candidate.target,
  value: "0",
  calldata: candidate.calldata,
  senderNonce: "3",
  tokenBalance: "1000000",
  nativeBalance: "100000000",
  gasEstimate: "50000",
  gasLimit: "55000",
  baseFeePerGas: "10",
  maxPriorityFeePerGas: "2",
  maxFeePerGas: "22",
  accessList: [],
  outcome: "success",
  expectedAssetDeltas: [
    {
      assetAddress: candidate.target,
      from: candidate.from,
      to: candidate.recipient,
      amountAtomic: candidate.amountAtomic,
    },
  ],
  maximumNativeFeeAtomic: "1210000",
  simulatorVersion: "viem@2.56.0",
  evidenceHash: `0x${"ef".repeat(32)}`,
} as const;

describe("P2-03 additive EVM execution schemas", () => {
  it("accepts the strict executable candidate and normalized success evidence", () => {
    expect(executableTransferCandidateSchema.safeParse(candidate).success).toBe(
      true,
    );
    expect(simulationEvidenceSchema.safeParse(evidence).success).toBe(true);
  });

  it.each([
    [
      "non-empty access list",
      {
        ...candidate,
        accessList: [{ address: candidate.target, storageKeys: [] }],
      },
    ],
    ["priority above max fee", { ...candidate, maxPriorityFeePerGas: "23" }],
    ["unknown candidate field", { ...candidate, signer: "forbidden" }],
  ])("rejects %s", (_name, value) => {
    expect(executableTransferCandidateSchema.safeParse(value).success).toBe(
      false,
    );
  });

  it("requires normalized revert evidence for a reverted simulation", () => {
    expect(
      simulationEvidenceSchema.safeParse({
        ...evidence,
        outcome: "revert",
        revert: { code: "EXECUTION_REVERT", data: "0xdeadbeef" },
      }).success,
    ).toBe(true);
    expect(
      simulationEvidenceSchema.safeParse({ ...evidence, outcome: "revert" })
        .success,
    ).toBe(false);
  });
});
