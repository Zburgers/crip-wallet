import { z } from "zod";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import {
  canonicalHashSchema,
  canonicalIdentifierSchema,
  evmHashSchema,
  semverSchema,
  utcSecondSchema,
  versionSchema,
} from "./common.js";
import { chainIdSchema, evmAddressSchema } from "./intent.js";
import { canonicalizeIdempotencyPayload } from "./idempotency.js";
import { atomicUnitSchema } from "./money.js";

const calldataSchema = z.string().regex(/^0x[0-9a-f]*$/);
const blockReferenceSchema = z.string().regex(/^(?:0x[0-9a-f]+|[1-9][0-9]*)$/);

const decodedArgumentsSchema = z.strictObject({
  assetAddress: evmAddressSchema,
  recipient: evmAddressSchema,
  amountAtomic: atomicUnitSchema,
});

const assetDeltaSchema = z.strictObject({
  assetAddress: evmAddressSchema,
  from: evmAddressSchema,
  to: evmAddressSchema,
  amountAtomic: atomicUnitSchema,
});

const maximumFeeConstraintsSchema = z.strictObject({
  asset: z.literal("native"),
  maxFeePerGas: atomicUnitSchema,
  maximumNetworkFeeAtomic: atomicUnitSchema,
});

/** Exact immutable execution object bound to approval and authorization. */
export const canonicalExecutionEnvelopeSchema = z
  .strictObject({
    schemaVersion: versionSchema,
    envelopeId: canonicalIdentifierSchema,
    revision: z.number().int().positive().safe(),
    supersedesEnvelopeId: canonicalIdentifierSchema.optional(),
    intentId: canonicalIdentifierSchema,
    intentHash: canonicalHashSchema,
    agentId: canonicalIdentifierSchema,
    walletId: canonicalIdentifierSchema,
    adapterId: canonicalIdentifierSchema,
    adapterVersion: semverSchema,
    chainId: chainIdSchema,
    from: evmAddressSchema,
    to: evmAddressSchema,
    value: atomicUnitSchema,
    calldata: calldataSchema,
    decodedFunction: z.literal("erc20.transfer"),
    decodedArguments: decodedArgumentsSchema,
    expectedAssetDeltas: z.array(assetDeltaSchema).min(1),
    simulationBlockReference: blockReferenceSchema,
    simulationResultHash: evmHashSchema,
    nonceStrategy: z.enum(["pending", "latest", "explicit"]),
    gasLimit: atomicUnitSchema,
    maximumFeeConstraints: maximumFeeConstraintsSchema,
    policyId: canonicalIdentifierSchema,
    policyVersion: z.number().int().positive().safe(),
    policyDecisionHash: evmHashSchema,
    budgetReservationId: canonicalIdentifierSchema,
    createdAt: utcSecondSchema,
    expiresAt: utcSecondSchema,
    riskDecision: z.enum(["ALLOW", "REVIEW", "DENY"]),
    approvalRequirement: z.enum(["none", "owner"]),
    envelopeHash: evmHashSchema,
  })
  .superRefine((envelope, context) => {
    if (Date.parse(envelope.createdAt) >= Date.parse(envelope.expiresAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt must be later than createdAt",
      });
    }
  });

/** Alias used by callers that do not need the canonical prefix in the name. */
export const executionEnvelopeSchema = canonicalExecutionEnvelopeSchema;
export type ExecutionEnvelope = z.infer<
  typeof canonicalExecutionEnvelopeSchema
>;

/** Domain separator included in every execution-envelope hash preimage. */
export const ENVELOPE_HASH_DOMAIN = "crip/execution-envelope";

/** Hash-preimage version, independent from the JSON schema version. */
export const ENVELOPE_HASH_VERSION = "v1";

type CanonicalJsonValue = Parameters<typeof canonicalizeIdempotencyPayload>[0];

const envelopeHashInput = (candidate: unknown): CanonicalJsonValue => {
  const parsed = canonicalExecutionEnvelopeSchema.parse(candidate);
  const boundFields = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== "envelopeHash"),
  );
  return boundFields as CanonicalJsonValue;
};

/** Serialize all envelope-bound fields as deterministic UTF-8 canonical JSON bytes. */
export const canonicalizeExecutionEnvelope = (candidate: unknown): string =>
  canonicalizeIdempotencyPayload(envelopeHashInput(candidate));

/** Return the canonical envelope bytes used by the hash and approval boundary. */
export const serializeExecutionEnvelope = (candidate: unknown): Uint8Array =>
  utf8ToBytes(canonicalizeExecutionEnvelope(candidate));

/** Build the versioned, domain-separated Keccak hash preimage. */
export const buildEnvelopeHashPreimage = (candidate: unknown): Uint8Array =>
  concatBytes(
    utf8ToBytes(ENVELOPE_HASH_DOMAIN),
    utf8ToBytes(ENVELOPE_HASH_VERSION),
    Uint8Array.from([0]),
    serializeExecutionEnvelope(candidate),
  );

/** Hash the exact envelope-bound fields with Ethereum-compatible Keccak-256. */
export const hashExecutionEnvelope = (candidate: unknown): string =>
  `0x${bytesToHex(keccak_256(buildEnvelopeHashPreimage(candidate)))}`;

/** Replace the derived envelope hash with the hash of the validated bound fields. */
export const attachEnvelopeHash = (candidate: unknown): ExecutionEnvelope => {
  const parsed = canonicalExecutionEnvelopeSchema.parse(candidate);
  return {
    ...parsed,
    envelopeHash: hashExecutionEnvelope(parsed),
  };
};

/** Minimal approval binding persisted by approval workflows. */
export const envelopeApprovalBindingSchema = z.strictObject({
  envelopeHash: evmHashSchema,
});
export type EnvelopeApprovalBinding = z.infer<
  typeof envelopeApprovalBindingSchema
>;

/** Create a one-envelope approval binding from the derived hash. */
export const createEnvelopeApprovalBinding = (
  candidate: unknown,
): EnvelopeApprovalBinding => ({
  envelopeHash: hashExecutionEnvelope(candidate),
});

/** Check both the envelope's derived hash and the approval's bound hash. */
export const isEnvelopeApprovalBound = (
  approval: unknown,
  candidate: unknown,
): boolean => {
  const parsedApproval = envelopeApprovalBindingSchema.safeParse(approval);
  const parsedEnvelope = canonicalExecutionEnvelopeSchema.safeParse(candidate);
  if (!parsedApproval.success || !parsedEnvelope.success) return false;

  const expectedHash = hashExecutionEnvelope(parsedEnvelope.data);
  return (
    parsedEnvelope.data.envelopeHash === expectedHash &&
    parsedApproval.data.envelopeHash === expectedHash
  );
};
