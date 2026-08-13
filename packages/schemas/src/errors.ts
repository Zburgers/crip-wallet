import { z } from "zod";

import { canonicalIdentifierSchema } from "./common.js";
import { lifecycleStateSchema } from "./lifecycle.js";

/** Stable machine-readable failure taxonomy for every interface. */
export const ERROR_CODES = Object.freeze([
  "INVALID_INTENT",
  "IDEMPOTENCY_CONFLICT",
  "POLICY_DENIED",
  "POLICY_INDETERMINATE",
  "INSUFFICIENT_BUDGET",
  "APPROVAL_REQUIRED",
  "APPROVAL_EXPIRED",
  "AGENT_REVOKED",
  "SYSTEM_PAUSED",
  "ADAPTER_UNSUPPORTED",
  "SIMULATION_FAILED",
  "EXECUTION_DIVERGENCE",
  "SIGNING_FAILED",
  "BROADCAST_UNKNOWN",
  "CHAIN_REORG",
  "RECONCILIATION_DISPUTED",
  "INVALID_LIFECYCLE_TRANSITION",
] as const);

export const errorCodeSchema = z.enum(ERROR_CODES);

/** Structured error contract preserving retry and funds-movement uncertainty. */
export const stableErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().min(1).max(512),
  retryable: z.boolean(),
  lifecycleState: lifecycleStateSchema,
  fundsMayHaveMoved: z.boolean(),
  safeNextAction: z.enum([
    "correct_request",
    "retry",
    "request_approval",
    "check_operation",
    "reconcile",
    "contact_owner",
    "wait_for_confirmation",
    "do_not_retry",
  ]),
  correlationId: canonicalIdentifierSchema,
});

export const errorSchema = stableErrorSchema;
export type StableError = z.infer<typeof stableErrorSchema>;
