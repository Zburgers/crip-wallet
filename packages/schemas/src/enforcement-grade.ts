import { z } from "zod";

/** Canonical enforcement grades ordered from strongest to weakest. */
export const ENFORCEMENT_GRADES = Object.freeze([
  "ONCHAIN",
  "SIGNER",
  "CONTROL_PLANE",
  "ADVISORY",
  "UNSUPPORTED",
] as const);

/** Rejects every noncanonical enforcement-grade representation. */
export const enforcementGradeSchema = z.enum(ENFORCEMENT_GRADES);

/** A validated canonical enforcement grade. */
export type EnforcementGrade = z.infer<typeof enforcementGradeSchema>;

const enforcementStrength: Readonly<Record<EnforcementGrade, number>> =
  Object.freeze({
    ONCHAIN: 0,
    SIGNER: 1,
    CONTROL_PLANE: 2,
    ADVISORY: 3,
    UNSUPPORTED: 4,
  });

/** Returns whether an actual grade satisfies a policy's minimum grade. */
export const meetsMinimumEnforcementGrade = (
  actual: EnforcementGrade,
  required: EnforcementGrade,
): boolean => enforcementStrength[actual] <= enforcementStrength[required];
