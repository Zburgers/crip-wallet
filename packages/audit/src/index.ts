import { createHash } from "node:crypto";

import type { PoolClient } from "pg";

export type AuditActorType =
  "owner" | "agent" | "service" | "system" | "worker" | "adapter";
export type AuditEventType =
  | "budget.reservation.created"
  | "budget.reservation.authorized"
  | "budget.reservation.released"
  | "budget.reservation.expired"
  | "budget.reservation.finalized"
  | "budget.reservation.disputed";

export interface AuditContext {
  eventId: string;
  actorType: AuditActorType;
  actorId: string;
  ownerId: string;
  agentId: string;
  walletId: string;
  intentId: string;
  operationId: string;
  policyId: string;
  policyVersion: number;
  traceId: string;
}

export interface AuditEventInput extends AuditContext {
  eventType: AuditEventType;
  data: Record<string, unknown>;
}

/** Append one audit event on the caller's transaction client. */
export const appendAuditEvent = async (
  client: PoolClient,
  input: AuditEventInput,
): Promise<void> => {
  const previous = await client.query<{
    sequence_no: string;
    event_hash: string;
  }>(
    `SELECT sequence_no, event_hash FROM audit_events
     WHERE operation_id = $1 ORDER BY sequence_no DESC LIMIT 1 FOR UPDATE`,
    [input.operationId],
  );
  const sequence =
    (previous.rows[0] ? Number(previous.rows[0].sequence_no) : 0) + 1;
  const previousEventHash = previous.rows[0]?.event_hash ?? null;
  const canonical = JSON.stringify({
    eventId: input.eventId,
    eventType: input.eventType,
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
    data: input.data,
    previousEventHash,
  });
  const eventHash = `0x${createHash("sha256").update(canonical).digest("hex")}`;
  await client.query(
    `INSERT INTO audit_events
      (event_id, event_type, sequence_no, actor_type, actor_id, owner_id, agent_id, wallet_id,
       intent_id, operation_id, policy_id, policy_version, trace_id, data, previous_event_hash, event_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16)`,
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
      JSON.stringify(input.data),
      previousEventHash,
      eventHash,
    ],
  );
};
