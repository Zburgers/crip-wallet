import { z } from "zod";

import { enforcementGradeSchema } from "./enforcement-grade.js";
import {
  canonicalIdentifierSchema,
  evmHashSchema,
  utcSecondSchema,
  versionSchema,
} from "./common.js";
import { atomicUnitSchema } from "./money.js";

export const policyDecisionRuleSchema = z.strictObject({
  rule: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9_.-]*$/),
  result: z.enum(["pass", "fail", "indeterminate"]),
  limitAtomic: atomicUnitSchema.optional(),
  requestedAtomic: atomicUnitSchema.optional(),
});

const requiredEnforcementSchema = z
  .strictObject({
    budget: enforcementGradeSchema.optional(),
    recipient: enforcementGradeSchema.optional(),
    chain: enforcementGradeSchema.optional(),
    function: enforcementGradeSchema.optional(),
    expiry: enforcementGradeSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((grade) => grade !== undefined),
    {
      message: "at least one enforcement requirement is required",
    },
  );

/** Deterministic, auditable output of evaluating one policy version. */
export const policyDecisionSchema = z.strictObject({
  schemaVersion: versionSchema,
  decision: z.enum([
    "ALLOW_READ",
    "ALLOW_AUTONOMOUS",
    "REQUIRE_APPROVAL",
    "DENY",
    "INDETERMINATE",
  ]),
  policyId: canonicalIdentifierSchema,
  policyVersion: z.number().int().positive().safe(),
  evaluatedAt: utcSecondSchema,
  rules: z.array(policyDecisionRuleSchema).min(1),
  requiredEnforcement: requiredEnforcementSchema,
  decisionHash: evmHashSchema,
});

/** A validated policy decision; INDETERMINATE remains an explicit deny path. */
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
export type PolicyDecisionRule = z.infer<typeof policyDecisionRuleSchema>;
