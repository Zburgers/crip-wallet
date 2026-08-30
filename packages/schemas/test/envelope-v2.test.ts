import { describe, expect, it } from "vitest";

import {
  canonicalExecutionEnvelopeSchema,
  hashExecutionEnvelope,
} from "../src/index.js";

const envelopeV2 = {
  schemaVersion: "2.0",
  envelopeId: "env_local_v2_001",
  revision: 1,
  intentId: "int_local_001",
  intentHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  agentId: "agent_local_01",
  walletId: "wallet_local_01",
  adapterId: "local-anvil",
  adapterVersion: "0.1.0",
  chainId: "eip155:31337",
  from: "0x3333333333333333333333333333333333333333",
  to: "0x1111111111111111111111111111111111111111",
  value: "0",
  calldata:
    "0xa9059cbb0000000000000000000000222222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000007a120",
  decodedFunction: "erc20.transfer",
  decodedArguments: {
    assetAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    amountAtomic: "500000",
  },
  expectedAssetDeltas: [
    {
      assetAddress: "0x1111111111111111111111111111111111111111",
      from: "0x3333333333333333333333333333333333333333",
      to: "0x2222222222222222222222222222222222222222",
      amountAtomic: "500000",
    },
  ],
  simulationBlockNumber: "16",
  simulationBlockHash:
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  simulationResultHash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  nonceStrategy: "pending",
  nonce: "3",
  transactionType: "eip1559",
  gasLimit: "100000",
  maxPriorityFeePerGas: "100000000",
  accessList: [],
  maximumFeeConstraints: {
    asset: "native",
    maxFeePerGas: "1000000000",
    maximumNetworkFeeAtomic: "1000000000000000",
  },
  policyId: "policy_local_agent_01",
  policyVersion: 1,
  policyDecisionHash:
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  budgetReservationId: "res_local_001",
  createdAt: "2026-08-06T15:02:00Z",
  expiresAt: "2026-08-06T15:10:00Z",
  riskDecision: "ALLOW",
  approvalRequirement: "none",
  envelopeHash:
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
} as const;

const v2With = (change: Record<string, unknown>): Record<string, unknown> => ({
  ...envelopeV2,
  ...change,
});

describe("execution envelope v2", () => {
  it("accepts the exact EIP-1559 shape and produces a deterministic hash vector", () => {
    expect(canonicalExecutionEnvelopeSchema.safeParse(envelopeV2).success).toBe(
      true,
    );
    expect(hashExecutionEnvelope(envelopeV2)).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("uses a distinct hash domain from v1", () => {
    expect(hashExecutionEnvelope(envelopeV2)).not.toBe(
      "0xc3ff8d861b4122480cd59825b1d772816597bbc7219bf67ba2a43a4ba0e59e5f",
    );
  });

  it.each([
    ["nonce", "nonce"],
    ["transaction type", "transactionType"],
    ["priority fee", "maxPriorityFeePerGas"],
    ["access list", "accessList"],
    ["simulation block number", "simulationBlockNumber"],
    ["simulation block hash", "simulationBlockHash"],
  ])("rejects a missing v2 %s", (_name, field) => {
    const candidate = { ...envelopeV2 } as Record<string, unknown>;
    delete candidate[field];
    expect(canonicalExecutionEnvelopeSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it.each([
    ["unknown top-level field", v2With({ transactionHash: "0xabc" })],
    ["unknown nested field", v2With({ accessList: [{ address: envelopeV2.from }] })],
    ["nonempty access list", v2With({ accessList: [{ address: envelopeV2.from }] })],
    ["legacy transaction", v2With({ transactionType: "legacy" })],
    ["blob transaction", v2With({ blobVersionedHashes: [], transactionType: "blob" })],
    [
      "authorization-list transaction",
      v2With({ authorizationList: [], transactionType: "eip7702" }),
    ],
    ["unsafe numeric nonce", v2With({ nonce: 3 })],
    ["noncanonical nonce", v2With({ nonce: "03" })],
    ["hex nonce", v2With({ nonce: "0x3" })],
    ["fractional fee", v2With({ maxPriorityFeePerGas: "1.5" })],
    ["odd-length calldata", v2With({ calldata: "0xabc" })],
    ["uppercase address", v2With({ from: envelopeV2.from.toUpperCase() })],
    ["unsafe block number", v2With({ simulationBlockNumber: Number.MAX_SAFE_INTEGER + 1 })],
  ])("rejects %s", (_name, candidate) => {
    expect(canonicalExecutionEnvelopeSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it.each([
    ["chain", { chainId: "eip155:31338" }],
    ["from", { from: "0x4444444444444444444444444444444444444444" }],
    ["to", { to: "0x4444444444444444444444444444444444444444" }],
    ["value", { value: "1" }],
    ["calldata", { calldata: envelopeV2.calldata.replace("7a120", "7a121") }],
    ["nonce", { nonce: "4" }],
    ["gas limit", { gasLimit: "100001" }],
    ["priority fee", { maxPriorityFeePerGas: "100000001" }],
    ["max fee", { maximumFeeConstraints: { ...envelopeV2.maximumFeeConstraints, maxFeePerGas: "1000000001" } }],
    ["simulation block number", { simulationBlockNumber: "17" }],
    ["simulation block hash", { simulationBlockHash: envelopeV2.simulationBlockHash.replace("bb", "bc") }],
    ["intent", { intentId: "int_local_002" }],
    ["intent hash", { intentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
    ["policy", { policyId: "policy_local_agent_02" }],
    ["policy version", { policyVersion: 2 }],
    ["policy decision", { policyDecisionHash: envelopeV2.policyDecisionHash.replace("cc", "cd") }],
    ["reservation", { budgetReservationId: "res_local_002" }],
    ["expiry", { expiresAt: "2026-08-06T15:09:59Z" }],
    ["risk", { riskDecision: "REVIEW" }],
    ["approval", { approvalRequirement: "owner" }],
  ])("changes the hash when bound %s changes", (_name, change) => {
    const candidate = v2With(change);
    expect(canonicalExecutionEnvelopeSchema.safeParse(candidate).success).toBe(
      true,
    );
    expect(hashExecutionEnvelope(candidate)).not.toBe(
      hashExecutionEnvelope(envelopeV2),
    );
  });

  it("fails closed when the bound access list changes", () => {
    const candidate = v2With({ accessList: [{ address: envelopeV2.from }] });
    expect(canonicalExecutionEnvelopeSchema.safeParse(candidate).success).toBe(
      false,
    );
  });
});
