import { z } from "zod";

import { enforcementGradeSchema } from "./enforcement-grade.js";
import {
  canonicalIdentifierSchema,
  utcSecondSchema,
  versionSchema,
} from "./common.js";
import { chainIdSchema, evmAddressSchema } from "./intent.js";
import { atomicUnitSchema, positiveAtomicUnitSchema } from "./money.js";

const policyModeSchema = z.enum([
  "read-only",
  "review-required",
  "autonomous-within-policy",
]);

const policyStatusSchema = z.enum(["draft", "active", "superseded", "revoked"]);

const validitySchema = z
  .strictObject({
    notBefore: utcSecondSchema,
    expiresAt: utcSecondSchema,
  })
  .superRefine((validity, context) => {
    if (Date.parse(validity.notBefore) >= Date.parse(validity.expiresAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt must be later than notBefore",
      });
    }
  });

const assetAllowanceSchema = z.strictObject({
  chainId: chainIdSchema,
  type: z.literal("erc20"),
  address: evmAddressSchema,
});

/** Canonical versioned owner policy used by the deterministic policy engine. */
export const policySchema = z.strictObject({
  schemaVersion: versionSchema,
  policyId: canonicalIdentifierSchema,
  version: z.number().int().positive().safe(),
  status: policyStatusSchema,
  subject: z.strictObject({
    agentId: canonicalIdentifierSchema,
    walletId: canonicalIdentifierSchema,
  }),
  mode: policyModeSchema,
  validity: validitySchema,
  chains: z.strictObject({ allow: z.array(chainIdSchema).min(1) }),
  assets: z.strictObject({ allow: z.array(assetAllowanceSchema).min(1) }),
  recipients: z.strictObject({ allow: z.array(evmAddressSchema).min(1) }),
  actions: z.strictObject({
    allow: z.array(z.enum(["wallet.read_state", "asset.transfer"])).min(1),
  }),
  budgets: z.strictObject({
    total: z.strictObject({
      assetAddress: evmAddressSchema,
      atomic: positiveAtomicUnitSchema,
    }),
    perTransaction: z.strictObject({ atomic: positiveAtomicUnitSchema }),
  }),
  networkFees: z.strictObject({
    maximumPerTransactionAtomic: atomicUnitSchema,
  }),
  signatures: z.strictObject({
    personalSign: z.literal("deny"),
    typedData: z.literal("deny"),
    rawDigest: z.literal("deny"),
  }),
  transactions: z.strictObject({
    requireSimulation: z.literal(true),
    denyUnknownCalldata: z.literal(true),
    denyDelegatecall: z.literal(true),
    denyUnlimitedApprovals: z.literal(true),
  }),
  enforcement: z.strictObject({
    minimumBudgetGrade: enforcementGradeSchema,
    minimumRecipientGrade: enforcementGradeSchema,
  }),
});

/** A validated immutable policy contract. */
export type Policy = z.infer<typeof policySchema>;
export type PolicyMode = z.infer<typeof policyModeSchema>;
export type PolicyStatus = z.infer<typeof policyStatusSchema>;

export { policyModeSchema, policyStatusSchema };
