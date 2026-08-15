import { createHash } from "node:crypto";

import {
  auditDataSchema,
  auditEventSchema,
  canonicalizeIdempotencyPayload,
  type AuditEvent,
} from "@crip/schemas";
import type { PoolClient } from "pg";

export type AuditActorType =
  "owner" | "agent" | "service" | "system" | "worker" | "adapter";
export type AuditEventType =
  | "budget.reservation.created"
  | "budget.reservation.authorized"
  | "budget.reservation.broadcast"
  | "budget.reservation.evidence.verified"
  | "budget.reservation.released"
  | "budget.reservation.expired"
  | "budget.reservation.finalized"
  | "budget.reservation.disputed"
  | "approval.requested"
  | "approval.approved"
  | "approval.consumed"
  | "approval.rejected"
  | "approval.expired"
  | "approval.revoked"
  | "operation.state.changed"
  | "agent.revoked"
  | "owner.revoked"
  | "policy.revoked"
  | "system.paused"
  | "system.resumed";

export interface AuditCorrelation {
  reservationId: string;
  budgetId: string;
  ownerId: string;
  agentId: string;
  walletId: string;
  intentId: string;
  operationId: string;
  policyId: string;
  policyVersion: number;
}

export interface AuditContext {
  eventId: string;
  actorType: AuditActorType;
  actorId: string;
  traceId: string;
  /** Optional caller assertion; persisted correlation is always resolved from PostgreSQL. */
  assertedCorrelation?: Partial<AuditCorrelation>;
}

export interface AuditEventInput {
  eventId: string;
  actorType: AuditActorType;
  actorId: string;
  traceId: string;
  reservationId: string | null;
  ownerId: string | null;
  agentId: string | null;
  walletId: string | null;
  intentId: string | null;
  operationId: string | null;
  policyId: string | null;
  policyVersion: number | null;
  eventType: AuditEventType;
  data: Record<string, unknown>;
}

const AUDIT_EVENT_HASH_DOMAIN = "crip/audit-event/v1\u0000";

const canonicalizeAuditEvent = (event: AuditEvent): string =>
  canonicalizeIdempotencyPayload(
    JSON.parse(
      JSON.stringify({
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        sequence: event.sequence,
        actorType: event.actorType,
        actorId: event.actorId,
        ownerId: event.ownerId,
        agentId: event.agentId,
        walletId: event.walletId,
        intentId: event.intentId,
        operationId: event.operationId,
        policyId: event.policyId,
        policyVersion: event.policyVersion,
        traceId: event.traceId,
        data: event.data,
        previousEventHash: event.previousEventHash,
      }),
    ) as Parameters<typeof canonicalizeIdempotencyPayload>[0],
  );

const hashAuditEvent = (event: AuditEvent): string => {
  const canonicalPayload = canonicalizeAuditEvent(event);
  return `0x${createHash("sha256")
    .update(AUDIT_EVENT_HASH_DOMAIN, "utf8")
    .update(canonicalPayload, "utf8")
    .digest("hex")}`;
};

export const computeAuditEventHash = (event: AuditEvent): string =>
  hashAuditEvent(auditEventSchema.parse(event));

/** Parse and verify one persisted event, including its timestamp and chain link. */
export const verifyAuditEvent = (value: unknown): AuditEvent => {
  const event = auditEventSchema.parse(value);
  const expectedHash = hashAuditEvent(event);
  if (event.eventHash !== expectedHash)
    throw new Error(`audit event hash mismatch: ${event.eventId}`);
  return event;
};

/** Append one audit event on the caller's transaction client. */
export const appendAuditEvent = async (
  client: PoolClient,
  input: AuditEventInput,
): Promise<void> => {
  const data = auditDataSchema.parse(input.data);
  const isControlEvent = [
    "agent.revoked",
    "owner.revoked",
    "policy.revoked",
    "system.paused",
    "system.resumed",
  ].includes(input.eventType);
  if (isControlEvent && input.operationId !== null)
    throw new Error("control audit events cannot be operation-bound");
  if (!isControlEvent && input.operationId === null)
    throw new Error("non-control audit events require operation correlation");
  const previous = await client.query<{
    sequence_no: string;
    event_hash: string;
  }>(
    `SELECT sequence_no, event_hash FROM audit_events
     WHERE ($1::text IS NOT NULL AND operation_id = $1)
        OR ($1::text IS NULL AND operation_id IS NULL
            AND data ->> 'scopeType' = $2 AND data ->> 'scopeId' = $3)
     ORDER BY sequence_no DESC LIMIT 1 FOR UPDATE`,
    [input.operationId, data.scopeType ?? null, data.scopeId ?? null],
  );
  const sequence =
    (previous.rows[0] ? Number(previous.rows[0].sequence_no) : 0) + 1;
  const previousEventHash = previous.rows[0]?.event_hash ?? null;
  const occurredAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const unverifiedEvent = auditEventSchema.parse({
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt,
    sequence,
    actorType: input.actorType,
    actorId: input.actorId,
    ownerId: input.ownerId,
    agentId: input.agentId,
    walletId: input.walletId,
    intentId: input.intentId,
    operationId: input.operationId,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    traceId: input.traceId,
    data,
    previousEventHash,
    eventHash: `0x${"0".repeat(64)}`,
  });
  const canonicalPayload = canonicalizeAuditEvent(unverifiedEvent);
  const eventHash = computeAuditEventHash(unverifiedEvent);
  await client.query(
    `INSERT INTO audit_events
      (event_id, event_type, sequence_no, actor_type, actor_id, owner_id, agent_id, wallet_id,
       intent_id, operation_id, policy_id, policy_version, trace_id, data, previous_event_hash,
       event_hash, occurred_at, canonical_payload, reservation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19)`,
    [
      input.eventId,
      input.eventType,
      sequence,
      input.actorType,
      input.actorId,
      input.ownerId,
      input.agentId,
      input.walletId,
      input.intentId,
      input.operationId,
      input.policyId,
      input.policyVersion,
      input.traceId,
      JSON.stringify(data),
      previousEventHash,
      eventHash,
      occurredAt,
      canonicalPayload,
      input.reservationId,
    ],
  );
};
