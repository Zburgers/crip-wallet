import { describe, expect, it } from "vitest";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import {
  ENVELOPE_HASH_DOMAIN,
  ENVELOPE_HASH_VERSION,
  attachEnvelopeHash,
  buildEnvelopeHashPreimage,
  canonicalizeExecutionEnvelope,
  createEnvelopeApprovalBinding,
  hashExecutionEnvelope,
  isEnvelopeApprovalBound,
  serializeExecutionEnvelope,
} from "../src/index.js";

const envelope = {
  schemaVersion: "1.0",
  envelopeId: "env_local_001",
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
  calldata: "0xa9059cbb",
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
  simulationBlockReference: "0x10",
  simulationResultHash:
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  nonceStrategy: "pending",
  gasLimit: "100000",
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

describe("canonical execution-envelope serialization", () => {
  it("produces identical bytes for logically identical objects with different insertion order", () => {
    const reordered = {
      envelopeHash: envelope.envelopeHash,
      approvalRequirement: envelope.approvalRequirement,
      riskDecision: envelope.riskDecision,
      expiresAt: envelope.expiresAt,
      createdAt: envelope.createdAt,
      budgetReservationId: envelope.budgetReservationId,
      policyDecisionHash: envelope.policyDecisionHash,
      policyVersion: envelope.policyVersion,
      policyId: envelope.policyId,
      maximumFeeConstraints: { ...envelope.maximumFeeConstraints },
      gasLimit: envelope.gasLimit,
      nonceStrategy: envelope.nonceStrategy,
      simulationResultHash: envelope.simulationResultHash,
      simulationBlockReference: envelope.simulationBlockReference,
      expectedAssetDeltas: envelope.expectedAssetDeltas.map((delta) => ({
        ...delta,
      })),
      decodedArguments: { ...envelope.decodedArguments },
      decodedFunction: envelope.decodedFunction,
      calldata: envelope.calldata,
      value: envelope.value,
      to: envelope.to,
      from: envelope.from,
      chainId: envelope.chainId,
      adapterVersion: envelope.adapterVersion,
      adapterId: envelope.adapterId,
      walletId: envelope.walletId,
      agentId: envelope.agentId,
      intentHash: envelope.intentHash,
      intentId: envelope.intentId,
      revision: envelope.revision,
      envelopeId: envelope.envelopeId,
      schemaVersion: envelope.schemaVersion,
    } as const;

    expect(serializeExecutionEnvelope(reordered)).toEqual(
      serializeExecutionEnvelope(envelope),
    );
    expect(canonicalizeExecutionEnvelope(reordered)).toBe(
      canonicalizeExecutionEnvelope(envelope),
    );
  });

  it("matches the canonical byte fixture and versioned Keccak hash vector", () => {
    expect(bytesToHex(serializeExecutionEnvelope(envelope))).toMatch(
      /^7b22616461707465724964223a226c6f63616c2d616e76696c222c226164617074657256657273696f6e223a22302e312e3022/,
    );
    expect(hashExecutionEnvelope(envelope)).toBe(
      "0xc3ff8d861b4122480cd59825b1d772816597bbc7219bf67ba2a43a4ba0e59e5f",
    );
  });

  it("domain-separates and version-separates the hash preimage", () => {
    const preimage = buildEnvelopeHashPreimage(envelope);
    const domainBytes = utf8ToBytes(ENVELOPE_HASH_DOMAIN);
    const versionBytes = utf8ToBytes(ENVELOPE_HASH_VERSION);
    expect(bytesToHex(preimage.subarray(0, domainBytes.length))).toBe(
      bytesToHex(domainBytes),
    );
    expect(
      bytesToHex(
        preimage.subarray(
          domainBytes.length,
          domainBytes.length + versionBytes.length,
        ),
      ),
    ).toBe(bytesToHex(versionBytes));
    expect(ENVELOPE_HASH_DOMAIN).toBe("crip/execution-envelope");
    expect(ENVELOPE_HASH_VERSION).toBe("v1");
  });
});

describe("envelope hash binding", () => {
  it.each([
    [
      "amount",
      {
        decodedArguments: {
          ...envelope.decodedArguments,
          amountAtomic: "500001",
        },
      },
    ],
    ["policy version", { policyVersion: 2 }],
    ["calldata", { calldata: "0xa9059cbd" }],
    ["expiry", { expiresAt: "2026-08-06T15:09:59Z" }],
  ])("changes the hash when the bound %s changes", (_name, change) => {
    expect(hashExecutionEnvelope({ ...envelope, ...change })).not.toBe(
      hashExecutionEnvelope(envelope),
    );
  });

  it("rejects an old approval after an envelope-bound change", () => {
    const approvedEnvelope = attachEnvelopeHash(envelope);
    const approval = createEnvelopeApprovalBinding(approvedEnvelope);
    const changedEnvelope = attachEnvelopeHash({
      ...approvedEnvelope,
      policyVersion: 2,
    });

    expect(isEnvelopeApprovalBound(approval, approvedEnvelope)).toBe(true);
    expect(isEnvelopeApprovalBound(approval, changedEnvelope)).toBe(false);
    expect(changedEnvelope.envelopeHash).not.toBe(
      approvedEnvelope.envelopeHash,
    );
  });
});
