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
  "system.paused",
  "system.resumed",
  "adapter.error",
] as const);

export const auditDataSchema = z.strictObject({
  reservationId: canonicalIdentifierSchema.optional(),
  assetAddress: evmAddressSchema.optional(),
  amountAtomic: atomicUnitSchema.optional(),
  nonce: atomicUnitSchema.optional(),
  verificationStatus: z.enum(["PENDING", "VERIFIED"]).optional(),
  state: lifecycleStateSchema.optional(),
  previousState: lifecycleStateSchema.optional(),
  reasonCode: canonicalIdentifierSchema.optional(),
  failureCode: canonicalIdentifierSchema.optional(),
  transactionHash: evmHashSchema.optional(),
  envelopeHash: evmHashSchema.optional(),
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
});

/** Correlated, typed, append-only audit event payload. */
export const auditEventSchema = z.strictObject({
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
  ownerId: canonicalIdentifierSchema,
  agentId: canonicalIdentifierSchema,
  walletId: canonicalIdentifierSchema,
  intentId: canonicalIdentifierSchema,
  operationId: canonicalIdentifierSchema,
  policyId: canonicalIdentifierSchema,
  policyVersion: z.number().int().positive().safe(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  data: auditDataSchema,
  previousEventHash: evmHashSchema.nullable(),
  eventHash: evmHashSchema,
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditData = z.infer<typeof auditDataSchema>;
