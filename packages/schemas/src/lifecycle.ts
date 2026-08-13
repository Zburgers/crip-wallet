import { z } from "zod";

/** Every durable operation state, including terminal and recovery states. */
export const LIFECYCLE_STATES = Object.freeze([
  "DRAFT",
  "VALIDATED",
  "POLICY_PRECHECKED",
  "CONSTRUCTED",
  "DECODED",
  "VERIFIED",
  "SIMULATED",
  "POLICY_FINALIZED",
  "BUDGET_RESERVED",
  "ENVELOPE_FINALIZED",
  "AWAITING_APPROVAL",
  "AUTHORIZED",
  "SIGNING",
  "SIGNED",
  "BROADCAST",
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "RECONCILED",
  "REJECTED",
  "DENIED",
  "EXPIRED",
  "SIMULATION_FAILED",
  "SIGNING_FAILED",
  "BROADCAST_FAILED",
  "REVERTED",
  "CANCELLED",
  "DISPUTED",
  "REVOKED",
  "REVALIDATION_REQUIRED",
] as const);

export const lifecycleStateSchema = z.enum(LIFECYCLE_STATES);
export type LifecycleState = z.infer<typeof lifecycleStateSchema>;

const transitionTable: Readonly<
  Record<LifecycleState, readonly LifecycleState[]>
> = {
  DRAFT: ["VALIDATED", "REJECTED", "DENIED", "EXPIRED", "REVOKED"],
  VALIDATED: ["POLICY_PRECHECKED", "REJECTED", "DENIED", "EXPIRED", "REVOKED"],
  POLICY_PRECHECKED: [
    "CONSTRUCTED",
    "REJECTED",
    "DENIED",
    "EXPIRED",
    "REVOKED",
  ],
  CONSTRUCTED: ["DECODED", "REJECTED", "DENIED", "EXPIRED", "REVOKED"],
  DECODED: ["VERIFIED", "REJECTED", "DENIED", "EXPIRED", "REVOKED"],
  VERIFIED: ["SIMULATED", "REJECTED", "DENIED", "EXPIRED", "REVOKED"],
  SIMULATED: [
    "POLICY_FINALIZED",
    "SIMULATION_FAILED",
    "REJECTED",
    "DENIED",
    "EXPIRED",
    "REVOKED",
  ],
  POLICY_FINALIZED: [
    "BUDGET_RESERVED",
    "REVALIDATION_REQUIRED",
    "REJECTED",
    "DENIED",
    "EXPIRED",
    "REVOKED",
  ],
  BUDGET_RESERVED: [
    "ENVELOPE_FINALIZED",
    "REVALIDATION_REQUIRED",
    "EXPIRED",
    "REVOKED",
  ],
  ENVELOPE_FINALIZED: [
    "AWAITING_APPROVAL",
    "AUTHORIZED",
    "REVALIDATION_REQUIRED",
    "EXPIRED",
    "REVOKED",
  ],
  AWAITING_APPROVAL: [
    "AUTHORIZED",
    "REVALIDATION_REQUIRED",
    "EXPIRED",
    "CANCELLED",
    "REJECTED",
    "REVOKED",
  ],
  AUTHORIZED: [
    "SIGNING",
    "REVALIDATION_REQUIRED",
    "EXPIRED",
    "CANCELLED",
    "REVOKED",
  ],
  SIGNING: ["SIGNED", "SIGNING_FAILED", "REVOKED", "DISPUTED"],
  SIGNED: ["BROADCAST", "BROADCAST_FAILED", "DISPUTED", "REVOKED"],
  BROADCAST: ["PENDING_CONFIRMATION", "BROADCAST_FAILED", "DISPUTED"],
  PENDING_CONFIRMATION: [
    "CONFIRMED",
    "REVERTED",
    "DISPUTED",
    "BROADCAST_FAILED",
  ],
  CONFIRMED: ["RECONCILED", "DISPUTED"],
  RECONCILED: [],
  REJECTED: [],
  DENIED: [],
  EXPIRED: [],
  SIMULATION_FAILED: [],
  SIGNING_FAILED: [],
  BROADCAST_FAILED: ["DISPUTED"],
  REVERTED: ["RECONCILED", "DISPUTED"],
  CANCELLED: [],
  DISPUTED: ["RECONCILED"],
  REVOKED: [],
  REVALIDATION_REQUIRED: ["VALIDATED", "EXPIRED", "DENIED", "REVOKED"],
};

/** Explicit state adjacency table; consumers must not invent transitions. */
export const LIFECYCLE_TRANSITIONS = Object.freeze(transitionTable);

/** Strict transition contract that only accepts entries from the table. */
export const lifecycleTransitionSchema = z
  .strictObject({
    from: lifecycleStateSchema,
    to: lifecycleStateSchema,
  })
  .refine(({ from, to }) => transitionTable[from].includes(to), {
    message: "transition is not allowed by the lifecycle table",
  });

/** Stable error raised when a caller requests a transition outside the table. */
export class LifecycleTransitionError extends Error {
  readonly code = "INVALID_LIFECYCLE_TRANSITION" as const;

  constructor(
    readonly from: LifecycleState,
    readonly to: LifecycleState,
  ) {
    super(`invalid lifecycle transition: ${from} -> ${to}`);
    this.name = "LifecycleTransitionError";
  }
}

/** Returns whether a pair is an explicitly supported lifecycle transition. */
export const isValidLifecycleTransition = (
  from: unknown,
  to: unknown,
): boolean => {
  const parsedFrom = lifecycleStateSchema.safeParse(from);
  const parsedTo = lifecycleStateSchema.safeParse(to);
  return (
    parsedFrom.success &&
    parsedTo.success &&
    transitionTable[parsedFrom.data].includes(parsedTo.data)
  );
};

/** Apply one explicit transition or fail closed with a stable error. */
export const transitionLifecycleState = (
  from: unknown,
  to: unknown,
): LifecycleState => {
  const parsedFrom = lifecycleStateSchema.safeParse(from);
  const parsedTo = lifecycleStateSchema.safeParse(to);
  if (!parsedFrom.success || !parsedTo.success) {
    throw new TypeError("lifecycle states must be canonical values");
  }
  if (!transitionTable[parsedFrom.data].includes(parsedTo.data)) {
    throw new LifecycleTransitionError(parsedFrom.data, parsedTo.data);
  }
  return parsedTo.data;
};
