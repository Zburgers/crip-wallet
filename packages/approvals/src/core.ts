import {
  appendAuditEvent,
  type AuditContext,
  type AuditCorrelation,
  type AuditEventType,
} from "@crip/audit";
import { withSerializableTransaction } from "@crip/budget-ledger";
import {
  executionEnvelopeSchema,
  hashExecutionEnvelope,
  type ExecutionEnvelope,
} from "@crip/schemas";
import type { Pool, PoolClient } from "pg";
import { lockControlFences, type ControlFenceSnapshot } from "./control.js";

export * from "./control.js";

export type ApprovalStatus =
  "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED" | "CONSUMED";

export type ApprovalErrorCode =
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_CONFLICT"
  | "APPROVAL_BINDING_MISMATCH"
  | "APPROVAL_INVALID_STATE"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_REVOKED"
  | "APPROVAL_REPLAYED"
  | "AUTONOMOUS_POLICY_REQUIRED"
  | "AUTONOMOUS_CONFLICT"
  | "REVALIDATION_REQUIRED"
  | "AUTHORIZATION_STATE_INVALID";

export class ApprovalError extends Error {
  constructor(
    readonly code: ApprovalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

export type ApprovalAuditContext = AuditContext;

export type AuthorizationKind = "OWNER_APPROVAL" | "AUTONOMOUS_POLICY";

export interface CreateApprovalRequest {
  approvalId: string;
  operationId: string;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: string;
  policyDecisionId: string;
  issuedAt: string | Date;
  expiresAt: string | Date;
  nonce: string;
  audit: ApprovalAuditContext;
}

export interface ApproveApprovalRequest {
  approvalId: string;
  approverId: string;
  now?: string | Date;
  audit: ApprovalAuditContext;
}

export interface RejectApprovalRequest {
  approvalId: string;
  approverId: string;
  reason: string;
  audit: ApprovalAuditContext;
}

export interface RevokeApprovalRequest {
  approvalId: string;
  reason: string;
  audit: ApprovalAuditContext;
}

export interface ReplaceExecutionEnvelopeRequest {
  operationId: string;
  envelope: ExecutionEnvelope;
  reason: string;
  audit: ApprovalAuditContext;
}

export interface ConsumeApprovalRequest {
  approvalId: string;
  operationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: string;
  consumerId: string;
  now?: string | Date;
  audit: ApprovalAuditContext;
}

export interface AuthorizeAutonomousInput {
  authorizationId: string;
  operationId: string;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: `0x${string}`;
  policyDecisionId: string;
  policyDecisionHash: `0x${string}`;
  idempotencyKey: string;
}

export interface ApprovalSnapshot {
  approvalId: string;
  operationId: string;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: string;
  policyDecisionId: string;
  policyDecisionHash: string;
  policyId: string;
  policyVersion: number;
  approverId: string | null;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  status: ApprovalStatus;
  approvedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  revokedAt: string | null;
  consumedAt: string | null;
  reason: string | null;
  controlFences: ControlFenceSnapshot;
}

export interface AuthorizationEvidence {
  authorizationId: string;
  authorizationKind: AuthorizationKind;
  approvalId: string | null;
  operationId: string;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: string;
  policyDecisionId: string;
  policyDecisionHash: string;
  policyId: string;
  policyVersion: number;
  approverId: string | null;
  issuedAt: string;
  expiresAt: string;
  authorizedAt: string;
  consumedAt: string;
  consumerId: string;
  consumptionNonce: string;
  controlFences: ControlFenceSnapshot;
}

type TimestampValue = string | Date;

type ApprovalRow = {
  approval_id: string;
  operation_id: string;
  reservation_id: string;
  envelope_id: string;
  envelope_revision: number;
  envelope_hash: string;
  policy_decision_id: string;
  policy_decision_hash: string;
  policy_id: string;
  policy_version: number;
  approver_id: string | null;
  issued_at: Date | string;
  expires_at: Date | string;
  nonce: string;
  status: ApprovalStatus;
  approved_at: Date | string | null;
  rejected_at: Date | string | null;
  expired_at: Date | string | null;
  revoked_at: Date | string | null;
  consumed_at: Date | string | null;
  reason: string | null;
  current_state: string;
  intent_id: string;
  agent_id: string;
  wallet_id: string;
  owner_id: string;
  policy_decision_status: string;
  persisted_decision_hash: string;
  decision_policy_id: string;
  decision_policy_version: number;
  persisted_envelope_hash: string;
  persisted_envelope_revision: number;
  envelope_payload: unknown;
  latest_revision: number;
  reservation_status: string;
  reservation_expires_at: Date | string;
  budget_id: string;
  amount_atomic: string;
  budget_agent_id: string;
  budget_wallet_id: string;
  budget_policy_id: string;
  budget_policy_version: number;
  intent_agent_id: string;
  intent_wallet_id: string;
  intent_policy_id: string;
  intent_policy_version: number;
  policy_agent_id: string;
  policy_wallet_id: string;
  policy_owner_id: string;
  wallet_owner_id: string;
  policy_status: string;
  system_fence_version: string | number;
  system_state: "ACTIVE" | "PAUSED";
  owner_fence_version: string | number;
  owner_state: "ACTIVE" | "REVOKED";
  agent_fence_version: string | number;
  agent_state: "ACTIVE" | "REVOKED";
  policy_fence_version: string | number;
  policy_state: "ACTIVE" | "REVOKED";
  current_system_fence_version: string | number;
  current_system_state: "ACTIVE" | "PAUSED";
  current_owner_fence_version: string | number;
  current_owner_state: "ACTIVE" | "REVOKED";
  current_agent_fence_version: string | number;
  current_agent_state: "ACTIVE" | "REVOKED";
  current_policy_fence_version: string | number;
  current_policy_state: "ACTIVE" | "REVOKED";
};

type CommonRow = Omit<
  ApprovalRow,
  | "approval_id"
  | "approver_id"
  | "issued_at"
  | "expires_at"
  | "nonce"
  | "status"
  | "approved_at"
  | "rejected_at"
  | "expired_at"
  | "revoked_at"
  | "consumed_at"
  | "reason"
>;

const timestamp = (value: TimestampValue, label: string): string => {
  const parsed =
    value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (Number.isNaN(parsed.valueOf()))
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      `${label} must be a valid timestamp`,
    );
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const id = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      `${label} is not canonical`,
    );
  return value;
};

const hash = (value: string, label: string): string => {
  if (!/^0x[0-9a-f]{64}$/.test(value))
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      `${label} is not a canonical EVM hash`,
    );
  return value;
};

const iso = (value: Date | string | null): string | null =>
  value === null ? null : timestamp(value, "persisted timestamp");

const sameTimestamp = (left: TimestampValue, right: TimestampValue): boolean =>
  new Date(left).valueOf() === new Date(right).valueOf();

const mapApproval = (row: ApprovalRow): ApprovalSnapshot => ({
  approvalId: row.approval_id,
  operationId: row.operation_id,
  reservationId: row.reservation_id,
  envelopeId: row.envelope_id,
  envelopeRevision: row.envelope_revision,
  envelopeHash: row.envelope_hash,
  policyDecisionId: row.policy_decision_id,
  policyDecisionHash: row.policy_decision_hash,
  policyId: row.policy_id,
  policyVersion: row.policy_version,
  approverId: row.approver_id,
  issuedAt: timestamp(row.issued_at, "issued_at"),
  expiresAt: timestamp(row.expires_at, "expires_at"),
  nonce: row.nonce,
  status: row.status,
  approvedAt: iso(row.approved_at),
  rejectedAt: iso(row.rejected_at),
  expiredAt: iso(row.expired_at),
  revokedAt: iso(row.revoked_at),
  consumedAt: iso(row.consumed_at),
  reason: row.reason,
  controlFences: {
    systemFenceVersion: Number(row.system_fence_version),
    systemState: row.system_state,
    ownerFenceVersion: Number(row.owner_fence_version),
    ownerState: row.owner_state,
    agentFenceVersion: Number(row.agent_fence_version),
    agentState: row.agent_state,
    policyFenceVersion: Number(row.policy_fence_version),
    policyState: row.policy_state,
  },
});

const operationCorrelation = (
  row: CommonRow | ApprovalRow,
): AuditCorrelation => ({
  reservationId: row.reservation_id,
  budgetId: row.budget_id,
  ownerId: row.owner_id,
  agentId: row.agent_id,
  walletId: row.wallet_id,
  intentId: row.intent_id,
  operationId: row.operation_id,
  policyId: row.policy_id,
  policyVersion: row.policy_version,
});

const assertAuditCorrelation = (
  audit: AuditContext,
  correlation: AuditCorrelation,
): void => {
  for (const [field, asserted] of Object.entries(
    audit.assertedCorrelation ?? {},
  )) {
    if (
      asserted !== undefined &&
      asserted !== correlation[field as keyof AuditCorrelation]
    )
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        `audit correlation does not match persisted ${field}`,
      );
  }
};

const bindingData = (
  row: ApprovalRow | CommonRow,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  reservationId: row.reservation_id,
  approvalId:
    "approval_id" in row && row.approval_id !== null
      ? row.approval_id
      : undefined,
  envelopeId: row.envelope_id,
  envelopeRevision: row.envelope_revision,
  envelopeHash: row.envelope_hash,
  policyDecisionId: row.policy_decision_id,
  policyDecisionHash: row.policy_decision_hash,
  policyVersion: row.policy_version,
  issuedAt:
    "issued_at" in row ? timestamp(row.issued_at, "issued_at") : undefined,
  expiresAt:
    "expires_at" in row ? timestamp(row.expires_at, "expires_at") : undefined,
  systemFenceVersion: Number(row.system_fence_version),
  systemState: row.system_state,
  ownerFenceVersion: Number(row.owner_fence_version),
  ownerState: row.owner_state,
  agentFenceVersion: Number(row.agent_fence_version),
  agentState: row.agent_state,
  policyFenceVersion: Number(row.policy_fence_version),
  policyState: row.policy_state,
  ...extra,
});

const fenceSnapshot = (row: CommonRow | ApprovalRow): ControlFenceSnapshot => ({
  systemFenceVersion: Number(row.system_fence_version),
  systemState: row.system_state,
  ownerFenceVersion: Number(row.owner_fence_version),
  ownerState: row.owner_state,
  agentFenceVersion: Number(row.agent_fence_version),
  agentState: row.agent_state,
  policyFenceVersion: Number(row.policy_fence_version),
  policyState: row.policy_state,
});

const fencesAreActiveAndCurrent = (row: ApprovalRow | CommonRow): boolean => {
  const snapshot = fenceSnapshot(row);
  return (
    snapshot.systemState === "ACTIVE" &&
    snapshot.ownerState === "ACTIVE" &&
    snapshot.agentState === "ACTIVE" &&
    snapshot.policyState === "ACTIVE" &&
    snapshot.systemFenceVersion === Number(row.current_system_fence_version) &&
    snapshot.ownerFenceVersion === Number(row.current_owner_fence_version) &&
    snapshot.agentFenceVersion === Number(row.current_agent_fence_version) &&
    snapshot.policyFenceVersion === Number(row.current_policy_fence_version) &&
    row.current_system_state === "ACTIVE" &&
    row.current_owner_state === "ACTIVE" &&
    row.current_agent_state === "ACTIVE" &&
    row.current_policy_state === "ACTIVE"
  );
};

const fencesAreActive = (row: CommonRow | ApprovalRow): boolean =>
  row.system_state === "ACTIVE" &&
  row.owner_state === "ACTIVE" &&
  row.agent_state === "ACTIVE" &&
  row.policy_state === "ACTIVE";

const append = async (
  client: PoolClient,
  row: ApprovalRow | CommonRow,
  audit: ApprovalAuditContext,
  eventType: AuditEventType,
  suffix: string,
  data: Record<string, unknown>,
): Promise<void> => {
  const correlation = operationCorrelation(row);
  assertAuditCorrelation(audit, correlation);
  await appendAuditEvent(client, {
    eventId: `${audit.eventId}:${suffix}`,
    actorType: audit.actorType,
    actorId: audit.actorId,
    traceId: audit.traceId,
    ...correlation,
    eventType,
    data: { ...bindingData(row, data), reservationId: row.reservation_id },
  });
};

const approvalSelect = `
  SELECT a.approval_id, a.operation_id, a.reservation_id, a.envelope_id,
         a.envelope_revision, a.envelope_hash, a.policy_decision_id,
         a.policy_decision_hash, a.policy_id, a.policy_version, a.approver_id,
         a.issued_at, a.expires_at, a.nonce, a.status, a.approved_at,
         a.rejected_at, a.expired_at, a.revoked_at, a.consumed_at, a.reason,
         a.system_fence_version, a.system_state, a.owner_fence_version, a.owner_state,
         a.agent_fence_version, a.agent_state, a.policy_fence_version, a.policy_state,
         o.current_state, o.intent_id, o.agent_id, o.wallet_id,
         owner.owner_id,
         d.decision AS policy_decision_status,
         d.decision_hash AS persisted_decision_hash,
         d.policy_id AS decision_policy_id,
         d.policy_version AS decision_policy_version,
         e.envelope_hash AS persisted_envelope_hash,
         e.revision AS persisted_envelope_revision,
         e.payload AS envelope_payload,
         (SELECT max(revision)::integer FROM execution_envelopes latest
          WHERE latest.operation_id = o.operation_id) AS latest_revision,
         r.status AS reservation_status, r.expires_at AS reservation_expires_at,
         b.budget_id, r.amount_atomic,
         b.agent_id AS budget_agent_id, b.wallet_id AS budget_wallet_id,
         b.policy_id AS budget_policy_id, b.policy_version AS budget_policy_version,
         i.agent_id AS intent_agent_id, i.wallet_id AS intent_wallet_id,
         i.policy_id AS intent_policy_id, i.policy_version AS intent_policy_version,
         p.agent_id AS policy_agent_id, p.wallet_id AS policy_wallet_id,
         p.owner_id AS policy_owner_id, wallet.owner_id AS wallet_owner_id,
         p.status AS policy_status
  FROM approval_requests a
  JOIN operations o ON o.operation_id = a.operation_id
  JOIN budget_reservations r ON r.operation_id = a.operation_id
    AND r.reservation_id = a.reservation_id
  JOIN budget_accounts b ON b.budget_id = r.budget_id
  JOIN execution_envelopes e ON e.operation_id = a.operation_id
    AND e.envelope_id = a.envelope_id
  JOIN policy_decisions d ON d.operation_id = a.operation_id
    AND d.decision_id = a.policy_decision_id
  JOIN intents i ON i.intent_id = o.intent_id
  JOIN agents agent ON agent.agent_id = o.agent_id
  JOIN owners owner ON owner.owner_id = agent.owner_id
  JOIN wallets wallet ON wallet.wallet_id = o.wallet_id
  JOIN policies p ON p.policy_id = o.policy_id
  WHERE a.approval_id = $1`;

const commonSelect = `
  SELECT o.operation_id, r.reservation_id, e.envelope_id, e.revision AS envelope_revision,
         e.envelope_hash, d.decision_id AS policy_decision_id,
         d.decision_hash AS policy_decision_hash, o.policy_id,
         o.policy_version, o.current_state, o.intent_id, o.agent_id, o.wallet_id,
         owner.owner_id, d.decision AS policy_decision_status,
         d.decision_hash AS persisted_decision_hash,
         d.policy_id AS decision_policy_id, d.policy_version AS decision_policy_version,
         e.envelope_hash AS persisted_envelope_hash,
         e.revision AS persisted_envelope_revision, e.payload AS envelope_payload,
         (SELECT max(revision)::integer FROM execution_envelopes latest
          WHERE latest.operation_id = o.operation_id) AS latest_revision,
         r.status AS reservation_status, r.expires_at AS reservation_expires_at,
         b.budget_id, r.amount_atomic,
         b.agent_id AS budget_agent_id, b.wallet_id AS budget_wallet_id,
         b.policy_id AS budget_policy_id, b.policy_version AS budget_policy_version,
         i.agent_id AS intent_agent_id, i.wallet_id AS intent_wallet_id,
         i.policy_id AS intent_policy_id, i.policy_version AS intent_policy_version,
         p.agent_id AS policy_agent_id, p.wallet_id AS policy_wallet_id,
         p.owner_id AS policy_owner_id, wallet.owner_id AS wallet_owner_id,
         p.status AS policy_status
  FROM operations o
  JOIN budget_reservations r ON r.operation_id = o.operation_id
    AND r.reservation_id = $4
  JOIN budget_accounts b ON b.budget_id = r.budget_id
  JOIN execution_envelopes e ON e.operation_id = o.operation_id
    AND e.envelope_id = $2
  JOIN policy_decisions d ON d.operation_id = o.operation_id
    AND d.decision_id = $3
  JOIN intents i ON i.intent_id = o.intent_id
  JOIN agents agent ON agent.agent_id = o.agent_id
  JOIN owners owner ON owner.owner_id = agent.owner_id
  JOIN wallets wallet ON wallet.wallet_id = o.wallet_id
  JOIN policies p ON p.policy_id = o.policy_id
  WHERE o.operation_id = $1`;

const loadApproval = async (
  client: PoolClient,
  approvalId: string,
): Promise<ApprovalRow> => {
  const initial = await client.query<ApprovalRow>(approvalSelect, [approvalId]);
  const identity = initial.rows[0];
  if (!identity)
    throw new ApprovalError(
      "APPROVAL_NOT_FOUND",
      `approval not found: ${approvalId}`,
    );
  const currentFences = await lockControlFences(
    client,
    identity.owner_id,
    identity.agent_id,
    identity.policy_id,
  );
  const result = await client.query<ApprovalRow>(
    `${approvalSelect} FOR UPDATE OF a, o, r, b, e, d`,
    [approvalId],
  );
  const row = result.rows[0];
  if (!row)
    throw new ApprovalError(
      "APPROVAL_NOT_FOUND",
      `approval not found: ${approvalId}`,
    );
  return {
    ...row,
    current_system_fence_version: currentFences.systemFenceVersion,
    current_system_state: currentFences.systemState,
    current_owner_fence_version: currentFences.ownerFenceVersion,
    current_owner_state: currentFences.ownerState,
    current_agent_fence_version: currentFences.agentFenceVersion,
    current_agent_state: currentFences.agentState,
    current_policy_fence_version: currentFences.policyFenceVersion,
    current_policy_state: currentFences.policyState,
  };
};

const loadCommonByIds = async (
  client: PoolClient,
  operationId: string,
  envelopeId: string,
  policyDecisionId: string,
  reservationId: string,
): Promise<CommonRow> => {
  const initial = await client.query<CommonRow>(commonSelect, [
    operationId,
    envelopeId,
    policyDecisionId,
    reservationId,
  ]);
  const identity = initial.rows[0];
  if (!identity)
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "approval binding rows are incomplete or ambiguous",
    );
  const currentFences = await lockControlFences(
    client,
    identity.owner_id,
    identity.agent_id,
    identity.policy_id,
  );
  const result = await client.query<CommonRow>(
    `${commonSelect} FOR UPDATE OF o, r, b, e, d`,
    [operationId, envelopeId, policyDecisionId, reservationId],
  );
  const row = result.rows[0];
  if (!row)
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "approval binding rows are incomplete or ambiguous",
    );
  return {
    ...row,
    system_fence_version: currentFences.systemFenceVersion,
    system_state: currentFences.systemState,
    owner_fence_version: currentFences.ownerFenceVersion,
    owner_state: currentFences.ownerState,
    agent_fence_version: currentFences.agentFenceVersion,
    agent_state: currentFences.agentState,
    policy_fence_version: currentFences.policyFenceVersion,
    policy_state: currentFences.policyState,
    current_system_fence_version: currentFences.systemFenceVersion,
    current_system_state: currentFences.systemState,
    current_owner_fence_version: currentFences.ownerFenceVersion,
    current_owner_state: currentFences.ownerState,
    current_agent_fence_version: currentFences.agentFenceVersion,
    current_agent_state: currentFences.agentState,
    current_policy_fence_version: currentFences.policyFenceVersion,
    current_policy_state: currentFences.policyState,
  };
};

const loadCommon = async (
  client: PoolClient,
  request: CreateApprovalRequest,
): Promise<CommonRow> =>
  loadCommonByIds(
    client,
    request.operationId,
    request.envelopeId,
    request.policyDecisionId,
    request.reservationId,
  );

const loadAutonomousAuthorityIds = async (
  client: PoolClient,
  operationId: string,
): Promise<{
  reservation_id: string;
  envelope_id: string;
  policy_decision_id: string;
}> => {
  const result = await client.query<{
    reservation_id: string;
    envelope_id: string;
    policy_decision_id: string;
  }>(
    `SELECT r.reservation_id, e.envelope_id, d.decision_id AS policy_decision_id
     FROM operations o
     JOIN budget_reservations r ON r.operation_id = o.operation_id
     JOIN execution_envelopes e ON e.operation_id = o.operation_id
     JOIN policy_decisions d ON d.operation_id = o.operation_id
       AND d.decision_hash = e.payload ->> 'policyDecisionHash'
     WHERE o.operation_id = $1
     ORDER BY e.revision DESC
     LIMIT 1`,
    [operationId],
  );
  const authority = result.rows[0];
  if (!authority)
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "authoritative autonomous binding rows are incomplete or ambiguous",
    );
  return authority;
};

const persistedEnvelope = (row: CommonRow | ApprovalRow): ExecutionEnvelope => {
  const parsed = executionEnvelopeSchema.safeParse(row.envelope_payload);
  if (
    !parsed.success ||
    parsed.data.envelopeHash !== row.persisted_envelope_hash
  ) {
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "persisted envelope is not a valid canonical envelope",
    );
  }
  if (hashExecutionEnvelope(parsed.data) !== row.persisted_envelope_hash) {
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "persisted envelope hash does not match its immutable payload",
    );
  }
  return parsed.data;
};

const assertCommonBinding = (
  row: CommonRow | ApprovalRow,
): ExecutionEnvelope => {
  const envelope = persistedEnvelope(row);
  if (
    row.persisted_envelope_revision !== row.envelope_revision ||
    row.persisted_envelope_hash !== row.envelope_hash ||
    row.persisted_decision_hash !== row.policy_decision_hash ||
    row.decision_policy_id !== row.policy_id ||
    row.decision_policy_version !== row.policy_version ||
    row.policy_decision_status !== "REQUIRE_APPROVAL" ||
    envelope.intentId !== row.intent_id ||
    envelope.agentId !== row.agent_id ||
    envelope.walletId !== row.wallet_id ||
    envelope.policyId !== row.policy_id ||
    envelope.policyVersion !== row.policy_version ||
    envelope.policyDecisionHash !== row.policy_decision_hash ||
    envelope.budgetReservationId !== row.reservation_id
  ) {
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "persisted approval binding is inconsistent",
    );
  }
  return envelope;
};

const ensureLatestEnvelope = (row: CommonRow | ApprovalRow): void => {
  if (row.latest_revision !== row.envelope_revision)
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "approval is bound to a superseded envelope revision",
    );
};

const ensureApprovalRequestMatches = (
  row: ApprovalSnapshot,
  request: CreateApprovalRequest,
): void => {
  if (
    row.operationId !== request.operationId ||
    row.reservationId !== request.reservationId ||
    row.envelopeId !== request.envelopeId ||
    row.envelopeRevision !== request.envelopeRevision ||
    row.envelopeHash !== request.envelopeHash ||
    row.policyDecisionId !== request.policyDecisionId ||
    row.nonce !== request.nonce ||
    !sameTimestamp(row.issuedAt, request.issuedAt) ||
    !sameTimestamp(row.expiresAt, request.expiresAt)
  ) {
    throw new ApprovalError(
      "APPROVAL_CONFLICT",
      "approval ID is already bound to different authorization input",
    );
  }
};

const nowOr = (value: TimestampValue | undefined): string =>
  timestamp(value ?? new Date(), "authorization time");

const statusError = (status: ApprovalStatus): ApprovalError => {
  switch (status) {
    case "EXPIRED":
      return new ApprovalError("APPROVAL_EXPIRED", "approval is expired");
    case "REJECTED":
      return new ApprovalError("APPROVAL_REJECTED", "approval was rejected");
    case "REVOKED":
      return new ApprovalError("APPROVAL_REVOKED", "approval was revoked");
    case "CONSUMED":
      return new ApprovalError(
        "APPROVAL_REPLAYED",
        "approval was already consumed",
      );
    default:
      return new ApprovalError(
        "APPROVAL_INVALID_STATE",
        `approval is ${status}`,
      );
  }
};

const updateOperation = async (
  client: PoolClient,
  operationId: string,
  expected: string,
  next: string,
): Promise<void> => {
  const result = await client.query(
    `UPDATE operations SET current_state = $1, version = version + 1, updated_at = now()
     WHERE operation_id = $2 AND current_state = $3`,
    [next, operationId, expected],
  );
  if (result.rowCount !== 1)
    throw new ApprovalError(
      "AUTHORIZATION_STATE_INVALID",
      `operation cannot transition from ${expected} to ${next}`,
    );
};

const releaseReservation = async (
  client: PoolClient,
  row: CommonRow | ApprovalRow,
  expectedStatus: "HELD" | "AUTHORIZED",
  status: "RELEASED" | "EXPIRED",
): Promise<void> => {
  if (row.reservation_status !== expectedStatus)
    throw new ApprovalError(
      "AUTHORIZATION_STATE_INVALID",
      `reservation is ${row.reservation_status}, not ${expectedStatus}`,
    );
  const accountUpdate = await client.query(
    `UPDATE budget_accounts
     SET available = available + $1::numeric, reserved = reserved - $1::numeric,
         version = version + 1, updated_at = now()
     WHERE budget_id = $2`,
    [row.amount_atomic, row.budget_id],
  );
  if (accountUpdate.rowCount !== 1)
    throw new ApprovalError(
      "AUTHORIZATION_STATE_INVALID",
      "budget account changed before reservation release",
    );
  const reservationUpdate = await client.query(
    "UPDATE budget_reservations SET status = $1, updated_at = now() WHERE reservation_id = $2 AND status = $3",
    [status, row.reservation_id, expectedStatus],
  );
  if (reservationUpdate.rowCount !== 1)
    throw new ApprovalError(
      "AUTHORIZATION_STATE_INVALID",
      "reservation changed before release could be committed",
    );
};

const releaseHeldReservation = async (
  client: PoolClient,
  row: CommonRow | ApprovalRow,
  status: "RELEASED" | "EXPIRED",
): Promise<void> => releaseReservation(client, row, "HELD", status);

const releaseAuthorizedReservation = async (
  client: PoolClient,
  row: CommonRow | ApprovalRow,
): Promise<void> => releaseReservation(client, row, "AUTHORIZED", "RELEASED");

const recordDecision = async (
  client: PoolClient,
  row: ApprovalRow,
  type: "APPROVE" | "REJECT" | "EXPIRE" | "REVOKE" | "CONSUME",
  approverId: string,
  decidedAt: string,
  reason?: string,
): Promise<void> => {
  await client.query(
    `INSERT INTO approval_decisions
      (approval_decision_id, approval_id, decision_type, approver_id, decided_at,
       envelope_hash, policy_decision_id, policy_version, decision_nonce, reason,
       system_fence_version, system_state, owner_fence_version, owner_state,
       agent_fence_version, agent_state, policy_fence_version, policy_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      `${row.approval_id}:decision:${type.toLowerCase()}`,
      row.approval_id,
      type,
      approverId,
      decidedAt,
      row.envelope_hash,
      row.policy_decision_id,
      row.policy_version,
      `${row.nonce}:decision:${type.toLowerCase()}`,
      reason ?? null,
      row.system_fence_version,
      row.system_state,
      row.owner_fence_version,
      row.owner_state,
      row.agent_fence_version,
      row.agent_state,
      row.policy_fence_version,
      row.policy_state,
    ],
  );
};

const invalidateStaleApproval = async (
  client: PoolClient,
  row: ApprovalRow,
  audit: ApprovalAuditContext,
  now: string,
  reason: string,
): Promise<void> => {
  if (
    row.current_state !== "AWAITING_APPROVAL" ||
    row.reservation_status !== "HELD"
  )
    throw new ApprovalError(
      "AUTHORIZATION_STATE_INVALID",
      "stale approval cannot be invalidated from the current state",
    );
  await updateOperation(
    client,
    row.operation_id,
    "AWAITING_APPROVAL",
    "REVALIDATION_REQUIRED",
  );
  await releaseHeldReservation(client, row, "RELEASED");
  const result = await client.query(
    `UPDATE approval_requests
     SET status = 'REVOKED', approver_id = COALESCE(approver_id, $1), revoked_at = $2,
         reason = $3, updated_at = now()
     WHERE approval_id = $4 AND status IN ('PENDING', 'APPROVED')`,
    [audit.actorId, now, reason, row.approval_id],
  );
  if (result.rowCount !== 1)
    throw new ApprovalError(
      "AUTHORIZATION_STATE_INVALID",
      "approval changed while invalidating stale envelope",
    );
  const next = {
    ...row,
    status: "REVOKED" as const,
    current_state: "REVALIDATION_REQUIRED",
    reservation_status: "RELEASED",
  };
  await recordDecision(client, next, "REVOKE", audit.actorId, now, reason);
  await append(
    client,
    next,
    audit,
    "budget.reservation.released",
    "stale-release",
    {},
  );
  await append(client, next, audit, "approval.revoked", "stale-revoked", {
    reason,
  });
  await append(
    client,
    next,
    audit,
    "operation.state.changed",
    "stale-revalidation",
    {
      previousState: "AWAITING_APPROVAL",
      state: "REVALIDATION_REQUIRED",
      reason,
    },
  );
};

const expireLocked = async (
  client: PoolClient,
  row: ApprovalRow,
  audit: ApprovalAuditContext,
  now: string,
): Promise<void> => {
  if (
    row.current_state !== "AWAITING_APPROVAL" ||
    row.reservation_status !== "HELD"
  )
    throw new ApprovalError(
      "AUTHORIZATION_STATE_INVALID",
      "expired approval has an ambiguous reservation state",
    );
  await updateOperation(
    client,
    row.operation_id,
    "AWAITING_APPROVAL",
    "EXPIRED",
  );
  await releaseHeldReservation(client, row, "EXPIRED");
  const result = await client.query(
    `UPDATE approval_requests
     SET status = 'EXPIRED', expired_at = $1, reason = 'approval lifetime elapsed', updated_at = now()
     WHERE approval_id = $2 AND status IN ('PENDING', 'APPROVED')`,
    [now, row.approval_id],
  );
  if (result.rowCount !== 1)
    throw new ApprovalError(
      "AUTHORIZATION_STATE_INVALID",
      "approval changed while expiring",
    );
  const next = {
    ...row,
    status: "EXPIRED" as const,
    current_state: "EXPIRED",
    reservation_status: "EXPIRED",
  };
  await recordDecision(
    client,
    next,
    "EXPIRE",
    audit.actorId,
    now,
    "approval lifetime elapsed",
  );
  await append(
    client,
    next,
    audit,
    "budget.reservation.expired",
    "expired-budget",
    {},
  );
  await append(client, next, audit, "approval.expired", "expired-approval", {
    reason: "approval lifetime elapsed",
  });
  await append(
    client,
    next,
    audit,
    "operation.state.changed",
    "expired-operation",
    {
      previousState: "AWAITING_APPROVAL",
      state: "EXPIRED",
    },
  );
};

export const createApprovalRequest = async (
  pool: Pool,
  request: CreateApprovalRequest,
): Promise<ApprovalSnapshot> => {
  id(request.approvalId, "approvalId");
  id(request.operationId, "operationId");
  id(request.reservationId, "reservationId");
  id(request.envelopeId, "envelopeId");
  id(request.policyDecisionId, "policyDecisionId");
  id(request.nonce, "nonce");
  hash(request.envelopeHash, "envelopeHash");
  if (
    !Number.isInteger(request.envelopeRevision) ||
    request.envelopeRevision <= 0
  )
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "envelopeRevision must be positive",
    );
  const issuedAt = timestamp(request.issuedAt, "issuedAt");
  const expiresAt = timestamp(request.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt))
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "approval expiry must be after issuance",
    );

  return withSerializableTransaction(pool, async (client) => {
    const existing = await client.query<ApprovalRow>(
      `${approvalSelect} FOR UPDATE OF a, o, r, b, e, d`,
      [request.approvalId],
    );
    if (existing.rowCount) {
      const row = existing.rows[0]!;
      ensureApprovalRequestMatches(mapApproval(row), request);
      assertCommonBinding(row);
      ensureLatestEnvelope(row);
      return mapApproval(row);
    }

    const row = await loadCommon(client, request);
    const envelope = assertCommonBinding(row);
    ensureLatestEnvelope(row);
    if (!fencesAreActive(row))
      throw new ApprovalError(
        "REVALIDATION_REQUIRED",
        "approval cannot be created while a control fence is inactive",
      );
    if (
      request.envelopeRevision !== row.envelope_revision ||
      request.envelopeHash !== row.envelope_hash
    )
      throw new ApprovalError(
        "APPROVAL_BINDING_MISMATCH",
        "approval request does not match the authoritative envelope revision or hash",
      );
    if (
      row.current_state !== "ENVELOPE_FINALIZED" &&
      row.current_state !== "AWAITING_APPROVAL"
    )
      throw new ApprovalError(
        "REVALIDATION_REQUIRED",
        `operation is ${row.current_state}, not awaiting approval creation`,
      );
    if (row.reservation_status !== "HELD")
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        `reservation is ${row.reservation_status}, not HELD`,
      );
    if (
      Date.parse(issuedAt) < Date.parse(envelope.createdAt) ||
      Date.parse(expiresAt) > Date.parse(envelope.expiresAt)
    )
      throw new ApprovalError(
        "APPROVAL_BINDING_MISMATCH",
        "approval lifetime is outside the immutable envelope lifetime",
      );

    if (row.current_state === "ENVELOPE_FINALIZED")
      await updateOperation(
        client,
        row.operation_id,
        "ENVELOPE_FINALIZED",
        "AWAITING_APPROVAL",
      );
    await client.query(
      `INSERT INTO approval_requests
        (approval_id, operation_id, reservation_id, envelope_id, envelope_revision,
         envelope_hash, policy_decision_id, policy_decision_hash, policy_id, policy_version,
         issued_at, expires_at, nonce,
         system_fence_version, system_state, owner_fence_version, owner_state,
         agent_fence_version, agent_state, policy_fence_version, policy_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        request.approvalId,
        request.operationId,
        request.reservationId,
        request.envelopeId,
        request.envelopeRevision,
        request.envelopeHash,
        request.policyDecisionId,
        row.policy_decision_hash,
        row.policy_id,
        row.policy_version,
        issuedAt,
        expiresAt,
        request.nonce,
        row.system_fence_version,
        row.system_state,
        row.owner_fence_version,
        row.owner_state,
        row.agent_fence_version,
        row.agent_state,
        row.policy_fence_version,
        row.policy_state,
      ],
    );
    const next = {
      ...row,
      approval_id: request.approvalId,
      approver_id: null,
      issued_at: issuedAt,
      expires_at: expiresAt,
      nonce: request.nonce,
      status: "PENDING" as const,
      approved_at: null,
      rejected_at: null,
      expired_at: null,
      revoked_at: null,
      consumed_at: null,
      reason: null,
      current_state: "AWAITING_APPROVAL",
      current_system_fence_version: row.system_fence_version,
      current_system_state: row.system_state,
      current_owner_fence_version: row.owner_fence_version,
      current_owner_state: row.owner_state,
      current_agent_fence_version: row.agent_fence_version,
      current_agent_state: row.agent_state,
      current_policy_fence_version: row.policy_fence_version,
      current_policy_state: row.policy_state,
    };
    await append(
      client,
      next,
      request.audit,
      "approval.requested",
      "requested",
      {},
    );
    return mapApproval(next);
  });
};

export const approveApproval = async (
  pool: Pool,
  request: ApproveApprovalRequest,
): Promise<ApprovalSnapshot> => {
  id(request.approvalId, "approvalId");
  id(request.approverId, "approverId");
  const now = nowOr(request.now);
  const outcome = await withSerializableTransaction(pool, async (client) => {
    const row = await loadApproval(client, request.approvalId);
    assertCommonBinding(row);
    if (row.status === "APPROVED") {
      if (row.approver_id !== request.approverId)
        throw new ApprovalError(
          "APPROVAL_CONFLICT",
          "approval is already assigned to a different approver",
        );
      return { kind: "snapshot" as const, value: mapApproval(row) };
    }
    if (row.status !== "PENDING") throw statusError(row.status);
    if (!fencesAreActiveAndCurrent(row)) {
      if (
        row.current_state === "AWAITING_APPROVAL" &&
        row.reservation_status === "HELD" &&
        (row.status === "PENDING" || row.status === "APPROVED")
      ) {
        await invalidateStaleApproval(
          client,
          row,
          request.audit,
          now,
          "control fence changed before approval",
        );
      }
      return { kind: "revalidation" as const };
    }
    if (Date.parse(now) < Date.parse(timestamp(row.issued_at, "issued_at")))
      throw new ApprovalError(
        "REVALIDATION_REQUIRED",
        "approval is not valid before its issuance time",
      );
    if (
      Date.parse(now) >= Date.parse(timestamp(row.expires_at, "expires_at"))
    ) {
      await expireLocked(client, row, request.audit, now);
      return { kind: "expired" as const };
    }
    if (
      row.current_state !== "AWAITING_APPROVAL" ||
      row.reservation_status !== "HELD"
    )
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "approval cannot be granted from the persisted state",
      );
    if (row.latest_revision !== row.envelope_revision) {
      await invalidateStaleApproval(
        client,
        row,
        request.audit,
        now,
        "envelope revision was superseded",
      );
      return { kind: "revalidation" as const };
    }
    const update = await client.query(
      `UPDATE approval_requests
       SET status = 'APPROVED', approver_id = $1, approved_at = $2, updated_at = now()
       WHERE approval_id = $3 AND status = 'PENDING'`,
      [request.approverId, now, request.approvalId],
    );
    if (update.rowCount !== 1)
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "approval changed before approval could be committed",
      );
    const next = {
      ...row,
      status: "APPROVED" as const,
      approver_id: request.approverId,
      approved_at: now,
    };
    await recordDecision(client, next, "APPROVE", request.approverId, now);
    await append(client, next, request.audit, "approval.approved", "approved", {
      approverId: request.approverId,
    });
    return { kind: "snapshot" as const, value: mapApproval(next) };
  });
  if (outcome.kind === "expired")
    throw new ApprovalError(
      "APPROVAL_EXPIRED",
      "approval expired before it was approved",
    );
  if (outcome.kind === "revalidation")
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "approval was invalidated by envelope replacement",
    );
  return outcome.value;
};

export const rejectApproval = async (
  pool: Pool,
  request: RejectApprovalRequest,
): Promise<ApprovalSnapshot> => {
  id(request.approvalId, "approvalId");
  id(request.approverId, "approverId");
  if (!request.reason.trim())
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "rejection reason is required",
    );
  const now = nowOr(undefined);
  return withSerializableTransaction(pool, async (client) => {
    const row = await loadApproval(client, request.approvalId);
    assertCommonBinding(row);
    if (row.status !== "PENDING") throw statusError(row.status);
    if (
      row.current_state !== "AWAITING_APPROVAL" ||
      row.reservation_status !== "HELD"
    )
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "approval cannot be rejected from the persisted state",
      );
    ensureLatestEnvelope(row);
    await updateOperation(
      client,
      row.operation_id,
      "AWAITING_APPROVAL",
      "REJECTED",
    );
    await releaseHeldReservation(client, row, "RELEASED");
    const update = await client.query(
      `UPDATE approval_requests
       SET status = 'REJECTED', approver_id = $1, rejected_at = $2, reason = $3, updated_at = now()
       WHERE approval_id = $4 AND status = 'PENDING'`,
      [request.approverId, now, request.reason, request.approvalId],
    );
    if (update.rowCount !== 1)
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "approval changed before rejection could be committed",
      );
    const next = {
      ...row,
      status: "REJECTED" as const,
      approver_id: request.approverId,
      rejected_at: now,
      reason: request.reason,
      current_state: "REJECTED",
      reservation_status: "RELEASED",
    };
    await recordDecision(
      client,
      next,
      "REJECT",
      request.approverId,
      now,
      request.reason,
    );
    await append(
      client,
      next,
      request.audit,
      "budget.reservation.released",
      "rejected-release",
      {},
    );
    await append(client, next, request.audit, "approval.rejected", "rejected", {
      approverId: request.approverId,
      reason: request.reason,
    });
    await append(
      client,
      next,
      request.audit,
      "operation.state.changed",
      "rejected-operation",
      {
        previousState: "AWAITING_APPROVAL",
        state: "REJECTED",
        reason: request.reason,
      },
    );
    return mapApproval(next);
  });
};

export const revokeApproval = async (
  pool: Pool,
  request: RevokeApprovalRequest,
): Promise<ApprovalSnapshot> => {
  id(request.approvalId, "approvalId");
  if (!request.reason.trim())
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "revocation reason is required",
    );
  const now = nowOr(undefined);
  return withSerializableTransaction(pool, async (client) => {
    const row = await loadApproval(client, request.approvalId);
    assertCommonBinding(row);
    if (row.status === "REVOKED") return mapApproval(row);
    if (row.status !== "PENDING" && row.status !== "APPROVED")
      throw statusError(row.status);
    if (
      row.current_state !== "AWAITING_APPROVAL" ||
      row.reservation_status !== "HELD"
    )
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "approval cannot be revoked from the persisted state",
      );
    await updateOperation(
      client,
      row.operation_id,
      "AWAITING_APPROVAL",
      "REVOKED",
    );
    await releaseHeldReservation(client, row, "RELEASED");
    const update = await client.query(
      `UPDATE approval_requests
       SET status = 'REVOKED', approver_id = COALESCE(approver_id, $1), revoked_at = $2,
           reason = $3, updated_at = now()
       WHERE approval_id = $4 AND status IN ('PENDING', 'APPROVED')`,
      [request.audit.actorId, now, request.reason, request.approvalId],
    );
    if (update.rowCount !== 1)
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "approval changed before revocation could be committed",
      );
    const next = {
      ...row,
      status: "REVOKED" as const,
      approver_id: row.approver_id ?? request.audit.actorId,
      revoked_at: now,
      reason: request.reason,
      current_state: "REVOKED",
      reservation_status: "RELEASED",
    };
    await recordDecision(
      client,
      next,
      "REVOKE",
      request.audit.actorId,
      now,
      request.reason,
    );
    await append(
      client,
      next,
      request.audit,
      "budget.reservation.released",
      "revoked-release",
      {},
    );
    await append(client, next, request.audit, "approval.revoked", "revoked", {
      reason: request.reason,
    });
    await append(
      client,
      next,
      request.audit,
      "operation.state.changed",
      "revoked-operation",
      {
        previousState: "AWAITING_APPROVAL",
        state: "REVOKED",
        reason: request.reason,
      },
    );
    return mapApproval(next);
  });
};

export const replaceExecutionEnvelope = async (
  pool: Pool,
  request: ReplaceExecutionEnvelopeRequest,
): Promise<ExecutionEnvelope> => {
  id(request.operationId, "operationId");
  if (!request.reason.trim())
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "envelope replacement reason is required",
    );
  const parsed = executionEnvelopeSchema.safeParse(request.envelope);
  if (
    !parsed.success ||
    hashExecutionEnvelope(parsed.data) !== parsed.data.envelopeHash
  )
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "replacement envelope is not a valid canonical envelope",
    );

  return withSerializableTransaction(pool, async (client) => {
    const identityResult = await client.query<{
      owner_id: string;
      agent_id: string;
      policy_id: string;
    }>(
      `SELECT ag.owner_id, o.agent_id, o.policy_id
       FROM operations o
       JOIN agents ag ON ag.agent_id = o.agent_id
       WHERE o.operation_id = $1`,
      [request.operationId],
    );
    const identity = identityResult.rows[0];
    if (!identity)
      throw new ApprovalError(
        "REVALIDATION_REQUIRED",
        "operation identity is missing",
      );
    await lockControlFences(
      client,
      identity.owner_id,
      identity.agent_id,
      identity.policy_id,
    );
    const operationResult = await client.query<{
      current_state: string;
      reservation_id: string;
      reservation_status: string;
    }>(
      `SELECT o.current_state, r.reservation_id, r.status AS reservation_status
       FROM operations o
       JOIN budget_reservations r ON r.operation_id = o.operation_id
       JOIN budget_accounts b ON b.budget_id = r.budget_id
       WHERE o.operation_id = $1
       FOR UPDATE OF o, r, b`,
      [request.operationId],
    );
    const operation = operationResult.rows[0];
    if (!operation)
      throw new ApprovalError(
        "REVALIDATION_REQUIRED",
        "operation or reservation binding is missing",
      );
    const latestResult = await client.query<{
      envelope_id: string;
      revision: number;
    }>(
      `SELECT envelope_id, revision
       FROM execution_envelopes
       WHERE operation_id = $1
       ORDER BY revision DESC
       LIMIT 1`,
      [request.operationId],
    );
    const latest = latestResult.rows[0];
    if (
      !latest ||
      parsed.data.revision !== latest.revision + 1 ||
      parsed.data.supersedesEnvelopeId !== latest.envelope_id
    )
      throw new ApprovalError(
        "REVALIDATION_REQUIRED",
        "replacement envelope revision lineage is invalid",
      );

    const activeResult = await client.query<{ approval_id: string }>(
      `SELECT approval_id
       FROM approval_requests
       WHERE operation_id = $1 AND status IN ('PENDING', 'APPROVED')
       FOR UPDATE`,
      [request.operationId],
    );
    const evidenceResult = await client.query<{ approval_id: string }>(
      `SELECT approval_id
       FROM authorization_evidence
       WHERE operation_id = $1
       FOR UPDATE`,
      [request.operationId],
    );

    if (operation.current_state === "AWAITING_APPROVAL") {
      if (
        activeResult.rowCount !== 1 ||
        operation.reservation_status !== "HELD" ||
        evidenceResult.rowCount !== 0
      )
        throw new ApprovalError(
          "AUTHORIZATION_STATE_INVALID",
          "approval replacement state is ambiguous",
        );
      const row = await loadApproval(client, activeResult.rows[0]!.approval_id);
      assertCommonBinding(row);
      ensureLatestEnvelope(row);
      await updateOperation(
        client,
        request.operationId,
        "AWAITING_APPROVAL",
        "REVALIDATION_REQUIRED",
      );
      await releaseHeldReservation(client, row, "RELEASED");
      const replacementApprover = row.approver_id ?? request.audit.actorId;
      const update = await client.query(
        `UPDATE approval_requests
         SET status = 'REVOKED', approver_id = $1, revoked_at = now(), reason = $2, updated_at = now()
         WHERE approval_id = $3 AND status IN ('PENDING', 'APPROVED')`,
        [replacementApprover, request.reason, row.approval_id],
      );
      if (update.rowCount !== 1)
        throw new ApprovalError(
          "AUTHORIZATION_STATE_INVALID",
          "approval changed before envelope replacement invalidation",
        );
      const next = {
        ...row,
        status: "REVOKED" as const,
        approver_id: replacementApprover,
        revoked_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        reason: request.reason,
        current_state: "REVALIDATION_REQUIRED",
        reservation_status: "RELEASED",
      };
      const now = timestamp(next.revoked_at, "revoked_at");
      await recordDecision(
        client,
        next,
        "REVOKE",
        request.audit.actorId,
        now,
        request.reason,
      );
      await append(
        client,
        next,
        request.audit,
        "budget.reservation.released",
        "replacement-release",
        {
          reason: request.reason,
          replacementEnvelopeId: parsed.data.envelopeId,
          replacementEnvelopeRevision: parsed.data.revision,
          replacementEnvelopeHash: parsed.data.envelopeHash,
        },
      );
      await append(
        client,
        next,
        request.audit,
        "approval.revoked",
        "replacement-revoked",
        {
          reason: request.reason,
          replacementEnvelopeId: parsed.data.envelopeId,
          replacementEnvelopeRevision: parsed.data.revision,
          replacementEnvelopeHash: parsed.data.envelopeHash,
        },
      );
      await append(
        client,
        next,
        request.audit,
        "operation.state.changed",
        "replacement-revalidation",
        {
          previousState: "AWAITING_APPROVAL",
          state: "REVALIDATION_REQUIRED",
          reason: request.reason,
          replacementEnvelopeId: parsed.data.envelopeId,
          replacementEnvelopeRevision: parsed.data.revision,
          replacementEnvelopeHash: parsed.data.envelopeHash,
        },
      );
    } else if (operation.current_state === "AUTHORIZED") {
      if (
        evidenceResult.rowCount !== 1 ||
        operation.reservation_status !== "AUTHORIZED" ||
        activeResult.rowCount !== 0
      )
        throw new ApprovalError(
          "AUTHORIZATION_STATE_INVALID",
          "authorized replacement state is ambiguous",
        );
      const row = await loadApproval(
        client,
        evidenceResult.rows[0]!.approval_id,
      );
      assertCommonBinding(row);
      ensureLatestEnvelope(row);
      await updateOperation(
        client,
        request.operationId,
        "AUTHORIZED",
        "REVALIDATION_REQUIRED",
      );
      await releaseAuthorizedReservation(client, row);
      const next = {
        ...row,
        current_state: "REVALIDATION_REQUIRED",
        reservation_status: "RELEASED",
      };
      await append(
        client,
        next,
        request.audit,
        "budget.reservation.released",
        "authorized-replacement-release",
        {
          reason: request.reason,
          replacementEnvelopeId: parsed.data.envelopeId,
          replacementEnvelopeRevision: parsed.data.revision,
          replacementEnvelopeHash: parsed.data.envelopeHash,
        },
      );
      await append(
        client,
        next,
        request.audit,
        "operation.state.changed",
        "authorized-replacement-revalidation",
        {
          previousState: "AUTHORIZED",
          state: "REVALIDATION_REQUIRED",
          reason: request.reason,
          replacementEnvelopeId: parsed.data.envelopeId,
          replacementEnvelopeRevision: parsed.data.revision,
          replacementEnvelopeHash: parsed.data.envelopeHash,
        },
      );
    } else {
      throw new ApprovalError(
        "REVALIDATION_REQUIRED",
        `operation is ${operation.current_state}, not replaceable`,
      );
    }

    await client.query(
      `INSERT INTO execution_envelopes
        (envelope_id, operation_id, revision, envelope_hash, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        parsed.data.envelopeId,
        request.operationId,
        parsed.data.revision,
        parsed.data.envelopeHash,
        JSON.stringify(parsed.data),
      ],
    );
    return parsed.data;
  });
};

export const consumeApproval = async (
  pool: Pool,
  request: ConsumeApprovalRequest,
): Promise<AuthorizationEvidence> => {
  id(request.approvalId, "approvalId");
  id(request.operationId, "operationId");
  id(request.envelopeId, "envelopeId");
  id(request.consumerId, "consumerId");
  hash(request.envelopeHash, "envelopeHash");
  if (
    !Number.isInteger(request.envelopeRevision) ||
    request.envelopeRevision <= 0
  )
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "envelopeRevision must be positive",
    );
  const now = nowOr(request.now);
  const outcome = await withSerializableTransaction(pool, async (client) => {
    const row = await loadApproval(client, request.approvalId);
    if (
      row.operation_id !== request.operationId ||
      row.envelope_id !== request.envelopeId ||
      row.envelope_revision !== request.envelopeRevision ||
      row.envelope_hash !== request.envelopeHash
    ) {
      throw new ApprovalError(
        "APPROVAL_BINDING_MISMATCH",
        "consumer input does not match persisted approval binding",
      );
    }
    assertCommonBinding(row);
    if (row.status !== "APPROVED") throw statusError(row.status);
    if (!fencesAreActiveAndCurrent(row)) {
      if (
        row.current_state === "AWAITING_APPROVAL" &&
        row.reservation_status === "HELD" &&
        row.status === "APPROVED"
      ) {
        await invalidateStaleApproval(
          client,
          row,
          request.audit,
          now,
          "control fence changed before authorization",
        );
      }
      return { kind: "revalidation" as const };
    }
    if (Date.parse(now) < Date.parse(timestamp(row.issued_at, "issued_at")))
      throw new ApprovalError(
        "REVALIDATION_REQUIRED",
        "approval is not valid before its issuance time",
      );
    if (
      Date.parse(now) >= Date.parse(timestamp(row.expires_at, "expires_at"))
    ) {
      await expireLocked(client, row, request.audit, now);
      return { kind: "expired" as const };
    }
    if (row.latest_revision !== row.envelope_revision) {
      await invalidateStaleApproval(
        client,
        row,
        request.audit,
        now,
        "envelope revision was superseded",
      );
      return { kind: "revalidation" as const };
    }
    if (
      row.current_state !== "AWAITING_APPROVAL" ||
      row.reservation_status !== "HELD"
    )
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "approval and reservation state is ambiguous",
      );

    const envelope = persistedEnvelope(row);
    const authorizedAt = now;
    const authorizationId = `${row.approval_id}:authorization`;
    const consumptionNonce = `${row.nonce}:consumed`;
    await updateOperation(
      client,
      row.operation_id,
      "AWAITING_APPROVAL",
      "AUTHORIZED",
    );
    const reservationUpdate = await client.query(
      "UPDATE budget_reservations SET status = 'AUTHORIZED', updated_at = now() WHERE reservation_id = $1 AND status = 'HELD'",
      [row.reservation_id],
    );
    if (reservationUpdate.rowCount !== 1)
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "reservation changed before authorization could be committed",
      );
    await client.query(
      `INSERT INTO authorization_evidence
        (authorization_id, approval_id, operation_id, reservation_id, envelope_id,
         envelope_revision, envelope_hash, policy_decision_id, policy_decision_hash,
         policy_id, policy_version, approver_id, issued_at, expires_at,
         authorized_at, consumed_at, consumer_id, consumption_nonce,
         system_fence_version, system_state, owner_fence_version, owner_state,
         agent_fence_version, agent_state, policy_fence_version, policy_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
      [
        authorizationId,
        row.approval_id,
        row.operation_id,
        row.reservation_id,
        envelope.envelopeId,
        envelope.revision,
        envelope.envelopeHash,
        row.policy_decision_id,
        row.policy_decision_hash,
        row.policy_id,
        row.policy_version,
        row.approver_id,
        timestamp(row.issued_at, "issued_at"),
        timestamp(row.expires_at, "expires_at"),
        authorizedAt,
        request.consumerId,
        consumptionNonce,
        row.system_fence_version,
        row.system_state,
        row.owner_fence_version,
        row.owner_state,
        row.agent_fence_version,
        row.agent_state,
        row.policy_fence_version,
        row.policy_state,
      ],
    );
    const approvalUpdate = await client.query(
      `UPDATE approval_requests
       SET status = 'CONSUMED', consumed_at = $1, updated_at = now()
       WHERE approval_id = $2 AND status = 'APPROVED'`,
      [authorizedAt, row.approval_id],
    );
    if (approvalUpdate.rowCount !== 1)
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "approval changed before consumption could be committed",
      );
    const next = {
      ...row,
      status: "CONSUMED" as const,
      consumed_at: authorizedAt,
      current_state: "AUTHORIZED",
      reservation_status: "AUTHORIZED",
    };
    await recordDecision(
      client,
      next,
      "CONSUME",
      row.approver_id!,
      authorizedAt,
    );
    await append(
      client,
      next,
      request.audit,
      "budget.reservation.authorized",
      "authorized-budget",
      {},
    );
    await append(client, next, request.audit, "approval.consumed", "consumed", {
      authorizationId,
      approverId: row.approver_id,
      consumerId: request.consumerId,
      consumptionNonce,
      authorizedAt,
      consumedAt: authorizedAt,
    });
    await append(
      client,
      next,
      request.audit,
      "operation.state.changed",
      "authorized-operation",
      {
        previousState: "AWAITING_APPROVAL",
        state: "AUTHORIZED",
        authorizationId,
      },
    );
    return {
      kind: "authorized" as const,
      value: {
        authorizationId,
        authorizationKind: "OWNER_APPROVAL" as const,
        approvalId: row.approval_id,
        operationId: row.operation_id,
        reservationId: row.reservation_id,
        envelopeId: envelope.envelopeId,
        envelopeRevision: envelope.revision,
        envelopeHash: envelope.envelopeHash,
        policyDecisionId: row.policy_decision_id,
        policyDecisionHash: row.policy_decision_hash,
        policyId: row.policy_id,
        policyVersion: row.policy_version,
        approverId: row.approver_id!,
        issuedAt: timestamp(row.issued_at, "issued_at"),
        expiresAt: timestamp(row.expires_at, "expires_at"),
        authorizedAt,
        consumedAt: authorizedAt,
        consumerId: request.consumerId,
        consumptionNonce,
        controlFences: fenceSnapshot(row),
      },
    };
  });
  if (outcome.kind === "expired")
    throw new ApprovalError(
      "APPROVAL_EXPIRED",
      "approval expired before consumption",
    );
  if (outcome.kind === "revalidation")
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "approval was invalidated by envelope replacement",
    );
  return outcome.value;
};

const autonomousConsumerId = "autonomous-policy-writer";

const assertAutonomousBinding = (
  row: CommonRow,
  request: AuthorizeAutonomousInput,
  now: string,
  expectedState: "ENVELOPE_FINALIZED" | "AUTHORIZED",
): ExecutionEnvelope => {
  const envelope = persistedEnvelope(row);
  if (
    row.operation_id !== request.operationId ||
    row.reservation_id !== request.reservationId ||
    row.envelope_id !== request.envelopeId ||
    row.envelope_revision !== request.envelopeRevision ||
    row.envelope_hash !== request.envelopeHash ||
    row.policy_decision_id !== request.policyDecisionId ||
    row.policy_decision_hash !== request.policyDecisionHash
  ) {
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "autonomous request does not match persisted binding claims",
    );
  }
  if (row.policy_decision_status !== "ALLOW_AUTONOMOUS") {
    throw new ApprovalError(
      "AUTONOMOUS_POLICY_REQUIRED",
      "only a persisted ALLOW_AUTONOMOUS decision can authorize autonomously",
    );
  }
  if (
    row.persisted_envelope_revision !== row.envelope_revision ||
    row.persisted_envelope_hash !== row.envelope_hash ||
    row.persisted_decision_hash !== row.policy_decision_hash ||
    row.decision_policy_id !== row.policy_id ||
    row.decision_policy_version !== row.policy_version ||
    row.policy_status !== "active" ||
    row.current_state !== expectedState ||
    row.reservation_status !==
      (expectedState === "AUTHORIZED" ? "AUTHORIZED" : "HELD") ||
    envelope.intentId !== row.intent_id ||
    envelope.agentId !== row.agent_id ||
    envelope.walletId !== row.wallet_id ||
    envelope.policyId !== row.policy_id ||
    envelope.policyVersion !== row.policy_version ||
    envelope.policyDecisionHash !== row.policy_decision_hash ||
    envelope.budgetReservationId !== row.reservation_id ||
    envelope.approvalRequirement !== "none" ||
    envelope.riskDecision !== "ALLOW" ||
    !fencesAreActiveAndCurrent(row) ||
    Date.parse(now) < Date.parse(envelope.createdAt) ||
    Date.parse(now) >= Date.parse(envelope.expiresAt) ||
    Date.parse(timestamp(row.reservation_expires_at, "reservation expiry")) <=
      Date.parse(now)
  ) {
    throw new ApprovalError(
      "REVALIDATION_REQUIRED",
      "persisted autonomous authorization binding is stale or inconsistent",
    );
  }
  return envelope;
};

const autonomousAuthorizationRow = async (
  client: PoolClient,
  authorizationId: string,
): Promise<{
  authorization_kind: AuthorizationKind;
  authorization_id: string;
  approval_id: string | null;
  operation_id: string;
  reservation_id: string;
  envelope_id: string;
  envelope_revision: number;
  envelope_hash: string;
  policy_decision_id: string;
  policy_decision_hash: string;
  policy_id: string;
  policy_version: number;
  approver_id: string | null;
  issued_at: Date | string;
  expires_at: Date | string;
  authorized_at: Date | string;
  consumed_at: Date | string;
  consumer_id: string;
  consumption_nonce: string;
  system_fence_version: string | number;
  system_state: "ACTIVE" | "PAUSED";
  owner_fence_version: string | number;
  owner_state: "ACTIVE" | "REVOKED";
  agent_fence_version: string | number;
  agent_state: "ACTIVE" | "REVOKED";
  policy_fence_version: string | number;
  policy_state: "ACTIVE" | "REVOKED";
} | null> => {
  const result = await client.query(
    `SELECT authorization_kind, authorization_id, approval_id, operation_id,
            reservation_id, envelope_id, envelope_revision, envelope_hash,
            policy_decision_id, policy_decision_hash, policy_id, policy_version,
            approver_id, issued_at, expires_at, authorized_at, consumed_at,
            consumer_id, consumption_nonce, system_fence_version, system_state,
            owner_fence_version, owner_state, agent_fence_version, agent_state,
            policy_fence_version, policy_state
     FROM authorization_evidence
     WHERE authorization_id = $1
     FOR UPDATE`,
    [authorizationId],
  );
  return result.rows[0] ?? null;
};

const mapAutonomousAuthorization = (
  row: NonNullable<Awaited<ReturnType<typeof autonomousAuthorizationRow>>>,
): AuthorizationEvidence => ({
  authorizationId: row.authorization_id,
  authorizationKind: row.authorization_kind,
  approvalId: row.approval_id,
  operationId: row.operation_id,
  reservationId: row.reservation_id,
  envelopeId: row.envelope_id,
  envelopeRevision: Number(row.envelope_revision),
  envelopeHash: row.envelope_hash,
  policyDecisionId: row.policy_decision_id,
  policyDecisionHash: row.policy_decision_hash,
  policyId: row.policy_id,
  policyVersion: Number(row.policy_version),
  approverId: row.approver_id,
  issuedAt: timestamp(row.issued_at, "issued_at"),
  expiresAt: timestamp(row.expires_at, "expires_at"),
  authorizedAt: timestamp(row.authorized_at, "authorized_at"),
  consumedAt: timestamp(row.consumed_at, "consumed_at"),
  consumerId: row.consumer_id,
  consumptionNonce: row.consumption_nonce,
  controlFences: {
    systemFenceVersion: Number(row.system_fence_version),
    systemState: row.system_state,
    ownerFenceVersion: Number(row.owner_fence_version),
    ownerState: row.owner_state,
    agentFenceVersion: Number(row.agent_fence_version),
    agentState: row.agent_state,
    policyFenceVersion: Number(row.policy_fence_version),
    policyState: row.policy_state,
  },
});

/**
 * Create the canonical autonomous authorization from PostgreSQL authority.
 * Caller fields are references and equality claims only; no transaction,
 * policy, fence, approval, or expiry authority is accepted from the caller.
 */
export const authorizeAutonomous = async (
  pool: Pool,
  request: AuthorizeAutonomousInput,
  audit: ApprovalAuditContext,
): Promise<AuthorizationEvidence> => {
  id(request.authorizationId, "authorizationId");
  id(request.operationId, "operationId");
  id(request.reservationId, "reservationId");
  id(request.envelopeId, "envelopeId");
  id(request.policyDecisionId, "policyDecisionId");
  id(request.idempotencyKey, "idempotencyKey");
  hash(request.envelopeHash, "envelopeHash");
  hash(request.policyDecisionHash, "policyDecisionHash");
  if (
    !Number.isInteger(request.envelopeRevision) ||
    request.envelopeRevision <= 0
  )
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "envelopeRevision must be positive",
    );

  return withSerializableTransaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('crip-wallet-autonomous-authorization:' || $1))",
      [request.operationId],
    );
    const existing = await autonomousAuthorizationRow(
      client,
      request.authorizationId,
    );
    const now = nowOr(undefined);
    if (existing) {
      const row = await loadCommonByIds(
        client,
        existing.operation_id,
        existing.envelope_id,
        existing.policy_decision_id,
        existing.reservation_id,
      );
      assertAutonomousBinding(row, request, now, "AUTHORIZED");
      const expectedNonce = `${request.idempotencyKey}:autonomous`;
      if (
        existing.authorization_kind !== "AUTONOMOUS_POLICY" ||
        existing.approval_id !== null ||
        existing.approver_id !== null ||
        existing.consumer_id !== autonomousConsumerId ||
        existing.consumption_nonce !== expectedNonce
      )
        throw new ApprovalError(
          "AUTONOMOUS_CONFLICT",
          "authorization ID is already bound to different autonomous evidence",
        );
      return mapAutonomousAuthorization(existing);
    }

    const authority = await loadAutonomousAuthorityIds(
      client,
      request.operationId,
    );
    const row = await loadCommonByIds(
      client,
      request.operationId,
      authority.envelope_id,
      authority.policy_decision_id,
      authority.reservation_id,
    );
    const existingOperationAuthorization = await client.query<{
      authorization_id: string;
    }>(
      `SELECT authorization_id FROM authorization_evidence
       WHERE operation_id = $1
       FOR UPDATE`,
      [request.operationId],
    );
    if (existingOperationAuthorization.rowCount)
      throw new ApprovalError(
        "AUTONOMOUS_CONFLICT",
        "operation already has canonical authorization evidence",
      );
    const envelope = assertAutonomousBinding(
      row,
      request,
      now,
      "ENVELOPE_FINALIZED",
    );
    ensureLatestEnvelope(row);
    const activeApproval = await client.query(
      `SELECT 1 FROM approval_requests
       WHERE operation_id = $1 AND status IN ('PENDING', 'APPROVED')
       FOR UPDATE`,
      [request.operationId],
    );
    if (activeApproval.rowCount)
      throw new ApprovalError(
        "AUTONOMOUS_CONFLICT",
        "operation has an active owner approval request",
      );

    const authorizedAt = now;
    const issuedAt = timestamp(envelope.createdAt, "envelope.createdAt");
    const expiresAt = timestamp(envelope.expiresAt, "envelope.expiresAt");
    const consumptionNonce = `${request.idempotencyKey}:autonomous`;
    await updateOperation(
      client,
      request.operationId,
      "ENVELOPE_FINALIZED",
      "AUTHORIZED",
    );
    const reservationUpdate = await client.query(
      `UPDATE budget_reservations
       SET status = 'AUTHORIZED', updated_at = now()
       WHERE operation_id = $1 AND reservation_id = $2 AND status = 'HELD'`,
      [request.operationId, request.reservationId],
    );
    if (reservationUpdate.rowCount !== 1)
      throw new ApprovalError(
        "AUTHORIZATION_STATE_INVALID",
        "reservation changed before autonomous authorization could be committed",
      );
    await client.query(
      `INSERT INTO authorization_evidence
        (authorization_id, authorization_kind, approval_id, operation_id,
         reservation_id, envelope_id, envelope_revision, envelope_hash,
         policy_decision_id, policy_decision_hash, policy_id, policy_version,
         approver_id, issued_at, expires_at, authorized_at, consumed_at,
         consumer_id, consumption_nonce, system_fence_version, system_state,
         owner_fence_version, owner_state, agent_fence_version, agent_state,
         policy_fence_version, policy_state)
       VALUES ($1, 'AUTONOMOUS_POLICY', NULL, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, NULL, $11, $12, $13, $13, $14, $15, $16, $17,
               $18, $19, $20, $21, $22, $23)`,
      [
        request.authorizationId,
        row.operation_id,
        row.reservation_id,
        envelope.envelopeId,
        envelope.revision,
        envelope.envelopeHash,
        row.policy_decision_id,
        row.policy_decision_hash,
        row.policy_id,
        row.policy_version,
        issuedAt,
        expiresAt,
        authorizedAt,
        autonomousConsumerId,
        consumptionNonce,
        row.system_fence_version,
        row.system_state,
        row.owner_fence_version,
        row.owner_state,
        row.agent_fence_version,
        row.agent_state,
        row.policy_fence_version,
        row.policy_state,
      ],
    );
    const next = {
      ...row,
      issued_at: issuedAt,
      expires_at: expiresAt,
      approval_id: null,
      approver_id: null,
    };
    await append(
      client,
      next,
      audit,
      "budget.reservation.authorized",
      "autonomous-authorized-budget",
      {
        authorizationId: request.authorizationId,
        consumerId: autonomousConsumerId,
        consumptionNonce,
        authorizedAt,
        consumedAt: authorizedAt,
        decision: "ALLOW_AUTONOMOUS",
      },
    );
    await append(
      client,
      next,
      audit,
      "operation.state.changed",
      "autonomous-authorized-operation",
      {
        authorizationId: request.authorizationId,
        previousState: "ENVELOPE_FINALIZED",
        state: "AUTHORIZED",
      },
    );
    return mapAutonomousAuthorization({
      authorization_kind: "AUTONOMOUS_POLICY",
      authorization_id: request.authorizationId,
      approval_id: null,
      operation_id: row.operation_id,
      reservation_id: row.reservation_id,
      envelope_id: envelope.envelopeId,
      envelope_revision: envelope.revision,
      envelope_hash: envelope.envelopeHash,
      policy_decision_id: row.policy_decision_id,
      policy_decision_hash: row.policy_decision_hash,
      policy_id: row.policy_id,
      policy_version: row.policy_version,
      approver_id: null,
      issued_at: issuedAt,
      expires_at: expiresAt,
      authorized_at: authorizedAt,
      consumed_at: authorizedAt,
      consumer_id: autonomousConsumerId,
      consumption_nonce: consumptionNonce,
      system_fence_version: row.system_fence_version,
      system_state: row.system_state,
      owner_fence_version: row.owner_fence_version,
      owner_state: row.owner_state,
      agent_fence_version: row.agent_fence_version,
      agent_state: row.agent_state,
      policy_fence_version: row.policy_fence_version,
      policy_state: row.policy_state,
    });
  });
};
