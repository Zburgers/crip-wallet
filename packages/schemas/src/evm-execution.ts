import { z } from "zod";

import { canonicalIdentifierSchema, evmHashSchema } from "./common.js";
import { evmAddressSchema } from "./intent.js";
import { atomicUnitSchema } from "./money.js";

const calldataSchema = z.string().regex(/^0x(?:[0-9a-f]{2})*$/);
const provenanceSchema = z.strictObject({
  intentId: canonicalIdentifierSchema,
  agentId: canonicalIdentifierSchema,
  walletId: canonicalIdentifierSchema,
  operationId: canonicalIdentifierSchema.optional(),
  policyId: canonicalIdentifierSchema.optional(),
  policyVersion: z.number().int().positive().safe().optional(),
  policyDecisionHash: evmHashSchema.optional(),
});

/** Additive strict schema for the resolved local type-2 candidate. */
export const executableTransferCandidateSchema = z
  .strictObject({
    action: z.literal("asset.transfer"),
    chainId: z.literal("eip155:31337"),
    from: evmAddressSchema,
    target: evmAddressSchema,
    nativeValue: z.literal("0"),
    calldata: calldataSchema,
    selector: z.literal("0xa9059cbb"),
    recipient: evmAddressSchema,
    amountAtomic: atomicUnitSchema,
    nonceStrategy: z.literal("pending"),
    fixtureInstanceId: canonicalIdentifierSchema,
    provenance: provenanceSchema,
    nonce: atomicUnitSchema,
    transactionType: z.literal("eip1559"),
    gasLimit: atomicUnitSchema,
    maxPriorityFeePerGas: atomicUnitSchema,
    maxFeePerGas: atomicUnitSchema,
    accessList: z.tuple([]),
  })
  .superRefine((candidate, context) => {
    if (
      BigInt(candidate.maxPriorityFeePerGas) > BigInt(candidate.maxFeePerGas)
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxPriorityFeePerGas"],
        message: "maxPriorityFeePerGas must not exceed maxFeePerGas",
      });
    }
  });

export type ExecutableTransferCandidate = z.infer<
  typeof executableTransferCandidateSchema
>;

const expectedAssetDeltaSchema = z.strictObject({
  assetAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  amountAtomic: atomicUnitSchema,
});

const simulationRevertSchema = z.strictObject({
  code: z.literal("EXECUTION_REVERT"),
  data: z
    .string()
    .regex(/^0x(?:[0-9a-f]{2})*$/)
    .optional(),
});

/** Normalized, hashable, additive simulation evidence for one local fixture. */
export const simulationEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    fixtureInstanceId: canonicalIdentifierSchema,
    chainId: z.literal("eip155:31337"),
    blockNumber: atomicUnitSchema,
    blockHash: evmHashSchema,
    candidateHash: evmHashSchema,
    from: evmAddressSchema,
    to: evmAddressSchema,
    value: z.literal("0"),
    calldata: calldataSchema,
    senderNonce: atomicUnitSchema,
    tokenBalance: atomicUnitSchema,
    nativeBalance: atomicUnitSchema,
    gasEstimate: atomicUnitSchema,
    gasLimit: atomicUnitSchema,
    baseFeePerGas: atomicUnitSchema,
    maxPriorityFeePerGas: atomicUnitSchema,
    maxFeePerGas: atomicUnitSchema,
    accessList: z.tuple([]),
    outcome: z.enum(["success", "revert"]),
    revert: simulationRevertSchema.optional(),
    expectedAssetDeltas: z.array(expectedAssetDeltaSchema).min(1),
    maximumNativeFeeAtomic: atomicUnitSchema,
    simulatorVersion: z.literal("viem@2.56.0"),
    evidenceHash: evmHashSchema,
  })
  .superRefine((evidence, context) => {
    if (evidence.outcome === "success" && evidence.revert !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["revert"],
        message: "successful simulation cannot contain revert evidence",
      });
    }
    if (evidence.outcome === "revert" && evidence.revert === undefined) {
      context.addIssue({
        code: "custom",
        path: ["revert"],
        message: "reverted simulation requires normalized revert evidence",
      });
    }
  });

export type SimulationEvidence = z.infer<typeof simulationEvidenceSchema>;
