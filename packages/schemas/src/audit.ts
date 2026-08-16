import { z } from "zod";

import {
  canonicalIdentifierSchema,
  evmHashSchema,
  utcSecondSchema,
} from "./common.js";
import { chainIdSchema, evmAddressSchema } from "./intent.js";
import { lifecycleStateSchema } from "./lifecycle.js";
import { atomicUnitSchema } from "./money.js";

export const AUDIT_EVENT_TYPES = Object.freeze([
  "intent.created",
  "intent.validated",
  "policy.evaluated",
  "policy.denied",
  "policy.indeterminate",
  "budget.reservation.created",
  "budget.reservation.authorized",
  "budget.reservation.broadcast",
  "budget.reservation.evidence.verified",
  "budget.reservation.released",
  "budget.reservation.expired",
  "budget.reservation.finalized",
  "budget.reservation.disputed",
  "operation.state.changed",
  "approval.requested",
  "approval.approved",
  "approval.consumed",
  "approval.rejected",
  "approval.expired",
  "approval.revoked",
  "signing.started",
  "signing.failed",
  "transaction.signed",
  "transaction.broadcast",
  "transaction.confirmed",
  "transaction.reconciled",
  "transaction.reverted",
  "operation.disputed",
  "agent.revoked",
  "owner.revoked",
  "policy.revoked",
  "system.paused",
  "system.resumed",
  "execution.recovery.claimed",
  "execution.recovery.ambiguous",
  "execution.recovery.resolved",
  "execution.recovery.conflict",
  "adapter.error",
] as const);

export const auditDataSchema = z.strictObject({
  reservationId: canonicalIdentifierSchema.optional(),
  approvalId: canonicalIdentifierSchema.optional(),
  authorizationId: canonicalIdentifierSchema.optional(),
  envelopeId: canonicalIdentifierSchema.optional(),
  envelopeRevision: z.number().int().positive().safe().optional(),
  policyDecisionId: canonicalIdentifierSchema.optional(),
  policyDecisionHash: evmHashSchema.optional(),
  policyVersion: z.number().int().positive().safe().optional(),
  approverId: canonicalIdentifierSchema.optional(),
  issuedAt: utcSecondSchema.optional(),
  expiresAt: utcSecondSchema.optional(),
  authorizedAt: utcSecondSchema.optional(),
  consumedAt: utcSecondSchema.optional(),
  consumptionNonce: canonicalIdentifierSchema.optional(),
  consumerId: canonicalIdentifierSchema.optional(),
  assetAddress: evmAddressSchema.optional(),
  amountAtomic: atomicUnitSchema.optional(),
  actualSpendAtomic: atomicUnitSchema.optional(),
  nonce: atomicUnitSchema.optional(),
  verificationStatus: z.enum(["PENDING", "VERIFIED"]).optional(),
  state: lifecycleStateSchema.optional(),
  previousState: lifecycleStateSchema.optional(),
  reasonCode: canonicalIdentifierSchema.optional(),
  failureCode: canonicalIdentifierSchema.optional(),
  transactionHash: evmHashSchema.optional(),
  envelopeHash: evmHashSchema.optional(),
  replacementEnvelopeId: canonicalIdentifierSchema.optional(),
  replacementEnvelopeRevision: z.number().int().positive().safe().optional(),
  replacementEnvelopeHash: evmHashSchema.optional(),
  decision: z
    .enum([
      "ALLOW_READ",
      "ALLOW_AUTONOMOUS",
      "REQUIRE_APPROVAL",
      "DENY",
      "INDETERMINATE",
    ])
    .optional(),
  adapterId: canonicalIdentifierSchema.optional(),
  chainId: chainIdSchema.optional(),
  proofReference: z.string().min(1).max(256).optional(),
  reason: z.string().min(1).max(512).optional(),
  scopeType: z.enum(["SYSTEM", "OWNER", "AGENT", "POLICY"]).optional(),
  scopeId: canonicalIdentifierSchema.optional(),
  fenceVersion: z.number().int().positive().safe().optional(),
  controlState: z.enum(["ACTIVE", "PAUSED", "REVOKED"]).optional(),
  previousControlState: z.enum(["ACTIVE", "PAUSED", "REVOKED"]).optional(),
  systemFenceVersion: z.number().int().positive().safe().optional(),
  systemState: z.enum(["ACTIVE", "PAUSED"]).optional(),
  ownerFenceVersion: z.number().int().positive().safe().optional(),
  ownerState: z.enum(["ACTIVE", "REVOKED"]).optional(),
  agentFenceVersion: z.number().int().positive().safe().optional(),
  agentState: z.enum(["ACTIVE", "REVOKED"]).optional(),
  policyFenceVersion: z.number().int().positive().safe().optional(),
  policyState: z.enum(["ACTIVE", "REVOKED"]).optional(),
  authorizationInvalidationId: canonicalIdentifierSchema.optional(),
  credentialId: canonicalIdentifierSchema.optional(),
  componentId: canonicalIdentifierSchema.optional(),
  componentRole: z.enum(["ADAPTER", "RECONCILER"]).optional(),
  authPayloadHash: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .optional(),
  authenticationMethod: z.literal("ed25519").optional(),
  attemptId: canonicalIdentifierSchema.optional(),
  leaseVersion: z.number().int().positive().safe().optional(),
  recoveryOutcome: z
    .enum(["CONFIRMED", "FAILED", "AMBIGUOUS", "CONFLICT"])
    .optional(),
  resolutionHash: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .optional(),
});

/** Correlated, typed, append-only audit event payload. */
export const auditEventSchema = z
  .strictObject({
    eventId: canonicalIdentifierSchema,
    eventType: z.enum(AUDIT_EVENT_TYPES),
    occurredAt: utcSecondSchema,
    sequence: z.number().int().positive().safe(),
    actorType: z.enum([
      "owner",
      "agent",
      "service",
      "system",
      "worker",
      "adapter",
    ]),
    actorId: canonicalIdentifierSchema,
    ownerId: canonicalIdentifierSchema.nullable(),
    agentId: canonicalIdentifierSchema.nullable(),
    walletId: canonicalIdentifierSchema.nullable(),
    intentId: canonicalIdentifierSchema.nullable(),
    operationId: canonicalIdentifierSchema.nullable(),
    policyId: canonicalIdentifierSchema.nullable(),
    policyVersion: z.number().int().positive().safe().nullable(),
    traceId: z.string().regex(/^[0-9a-f]{32}$/),
    data: auditDataSchema,
    previousEventHash: evmHashSchema.nullable(),
    eventHash: evmHashSchema,
  })
  .superRefine((event, context) => {
    const controlEvent = [
      "agent.revoked",
      "owner.revoked",
      "policy.revoked",
      "system.paused",
      "system.resumed",
    ].includes(event.eventType);
    if (controlEvent) {
      if (
        event.operationId !== null ||
        event.data.reservationId !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operationId"],
          message: "control events are not operation-bound",
        });
      }
      if (
        event.data.scopeType === undefined ||
        event.data.scopeId === undefined ||
        event.data.fenceVersion === undefined ||
        event.data.controlState === undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data"],
          message: "control events require fence scope and version data",
        });
      }
    } else if (
      event.ownerId === null ||
      event.agentId === null ||
      event.walletId === null ||
      event.intentId === null ||
      event.operationId === null ||
      event.policyId === null ||
      event.policyVersion === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operationId"],
        message: "non-control events require operation correlation",
      });
    }
  });

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditData = z.infer<typeof auditDataSchema>;
