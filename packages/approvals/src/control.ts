import { appendAuditEvent, type AuditContext } from "@crip/audit";
import { withSerializableTransaction } from "@crip/budget-ledger";
import type { Pool, PoolClient } from "pg";

export type ControlScopeType = "SYSTEM" | "OWNER" | "AGENT" | "POLICY";
export type ControlState = "ACTIVE" | "PAUSED" | "REVOKED";
export type ControlCommand = "PAUSE" | "RESUME" | "REVOKE";

export interface ControlFenceSnapshot {
  systemFenceVersion: number;
  systemState: "ACTIVE" | "PAUSED";
  ownerFenceVersion: number;
  ownerState: "ACTIVE" | "REVOKED";
  agentFenceVersion: number;
  agentState: "ACTIVE" | "REVOKED";
  policyFenceVersion: number;
  policyState: "ACTIVE" | "REVOKED";
}

export interface ChangeControlFenceRequest {
  scopeType: ControlScopeType;
  scopeId: string;
  command: ControlCommand;
  audit: AuditContext;
}

export interface ControlFenceResult {
  scopeType: ControlScopeType;
  scopeId: string;
  fenceVersion: number;
  state: ControlState;
  changed: boolean;
}

export class ControlFenceError extends Error {
  constructor(
    readonly code:
      | "INVALID_COMMAND"
      | "CONTROL_TARGET_NOT_FOUND"
      | "AUTHORIZATION_REVALIDATION_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "ControlFenceError";
  }
}

export interface RevalidateAuthorizationRequest {
  operationId: string;
  authorizationId: string;
}

type ControlRow = {
  scope_type: ControlScopeType;
  scope_id: string;
  fence_version: string | number;
  state: ControlState;
  last_control_event_id: string | null;
};

const id = (value: string, label: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:_-]*$/.test(value))
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      `${label} is not canonical`,
    );
};

const eventType = (scopeType: ControlScopeType, command: ControlCommand) => {
  if (scopeType === "SYSTEM")
    return command === "PAUSE" ? "system.paused" : "system.resumed";
  if (scopeType === "AGENT") return "agent.revoked";
  if (scopeType === "OWNER") return "owner.revoked";
  return "policy.revoked";
};

type ControlOperationRow = {
  approval_id: string | null;
  operation_id: string;
  reservation_id: string;
  budget_id: string;
  amount_atomic: string;
  envelope_id: string;
  envelope_revision: number;
  envelope_hash: string;
  policy_decision_id: string;
  policy_decision_hash: string;
  policy_version: number;
  approver_id: string | null;
  nonce: string;
  issued_at: Date | string | null;
  expires_at: Date | string | null;
  authorization_id: string | null;
  owner_id: string;
  agent_id: string;
  wallet_id: string;
  intent_id: string;
  policy_id: string;
  current_state: string;
  reservation_status: string;
};

const iso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value))
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

const targetPredicate = (scopeType: ControlScopeType): string => {
  switch (scopeType) {
    case "SYSTEM":
      return "TRUE";
    case "OWNER":
      return "ag.owner_id = $1";
    case "AGENT":
      return "o.agent_id = $1";
    case "POLICY":
      return "o.policy_id = $1";
  }
};

const controlData = (
  request: ChangeControlFenceRequest,
  fenceVersion: number,
  state: ControlState,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  scopeType: request.scopeType,
  scopeId: request.scopeId,
  fenceVersion,
  controlState: state,
  ...extra,
});

const operationAudit = async (
  client: PoolClient,
  request: ChangeControlFenceRequest,
  row: ControlOperationRow,
  eventType:
    | "budget.reservation.released"
    | "approval.revoked"
    | "operation.state.changed",
  suffix: string,
  fenceVersion: number,
  state: ControlState,
  data: Record<string, unknown>,
): Promise<void> => {
  await appendAuditEvent(client, {
    eventId: `${request.audit.eventId}:fence:${fenceVersion}:${row.operation_id}:${suffix}`,
    eventType,
    actorType: request.audit.actorType,
    actorId: request.audit.actorId,
    traceId: request.audit.traceId,
    reservationId: row.reservation_id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    walletId: row.wallet_id,
    intentId: row.intent_id,
    operationId: row.operation_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    data: {
      reservationId: row.reservation_id,
      ...(row.approval_id ? { approvalId: row.approval_id } : {}),
      envelopeId: row.envelope_id,
      envelopeRevision: row.envelope_revision,
      envelopeHash: row.envelope_hash,
      policyDecisionId: row.policy_decision_id,
      policyDecisionHash: row.policy_decision_hash,
      policyVersion: row.policy_version,
      ...(row.issued_at ? { issuedAt: iso(row.issued_at) } : {}),
      ...(row.expires_at ? { expiresAt: iso(row.expires_at) } : {}),
      ...controlData(request, fenceVersion, state),
      ...data,
    },
  });
};

const releaseReservation = async (
  client: PoolClient,
  row: ControlOperationRow,
): Promise<void> => {
  const account = await client.query(
    `UPDATE budget_accounts
     SET available = available + $1::numeric,
         reserved = reserved - $1::numeric,
         version = version + 1,
         updated_at = now()
     WHERE budget_id = $2 AND reserved >= $1::numeric`,
    [row.amount_atomic, row.budget_id],
  );
  if (account.rowCount !== 1)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      `held reservation cannot be released safely: ${row.reservation_id}`,
    );
  const reservation = await client.query(
    `UPDATE budget_reservations
     SET status = 'RELEASED', updated_at = now()
     WHERE reservation_id = $1 AND status IN ('HELD', 'AUTHORIZED')`,
    [row.reservation_id],
  );
  if (reservation.rowCount !== 1)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      `reservation changed before control invalidation: ${row.reservation_id}`,
    );
};

const invalidatePending = async (
  client: PoolClient,
  request: ChangeControlFenceRequest,
  row: ControlOperationRow,
  fenceVersion: number,
  state: ControlState,
): Promise<void> => {
  const nextState =
    request.scopeType === "SYSTEM" ? "REVALIDATION_REQUIRED" : "REVOKED";
  if (!row.approval_id)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      "approval binding is missing during fencing",
    );
  const operation = await client.query(
    `UPDATE operations SET current_state = $1, version = version + 1, updated_at = now()
     WHERE operation_id = $2 AND current_state = 'AWAITING_APPROVAL'`,
    [nextState, row.operation_id],
  );
  if (operation.rowCount !== 1)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      "approval operation changed during fencing",
    );
  await releaseReservation(client, row);
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const approval = await client.query(
    `UPDATE approval_requests
     SET status = 'REVOKED', approver_id = COALESCE(approver_id, $1),
         revoked_at = $2, reason = $3, updated_at = now()
     WHERE approval_id = $4 AND status IN ('PENDING', 'APPROVED')`,
    [
      request.audit.actorId,
      now,
      `control fence ${request.scopeType}:${request.scopeId}`,
      row.approval_id,
    ],
  );
  if (approval.rowCount !== 1)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      "approval changed during fencing",
    );
  await client.query(
    `INSERT INTO approval_decisions
      (approval_decision_id, approval_id, decision_type, approver_id, decided_at,
       envelope_hash, policy_decision_id, policy_version, decision_nonce, reason,
       system_fence_version, system_state, owner_fence_version, owner_state,
       agent_fence_version, agent_state, policy_fence_version, policy_state)
     SELECT $1, approval_id, 'REVOKE', COALESCE(approver_id, $2), $3,
            envelope_hash, policy_decision_id, policy_version, $4, $5,
            system_fence_version, system_state, owner_fence_version, owner_state,
            agent_fence_version, agent_state, policy_fence_version, policy_state
     FROM approval_requests WHERE approval_id = $6`,
    [
      `${row.approval_id}:decision:revoke`,
      request.audit.actorId,
      now,
      `${row.nonce}:decision:revoke`,
      `control fence ${request.scopeType}:${request.scopeId}`,
      row.approval_id,
    ],
  );
  const reason = `control fence ${request.scopeType}:${request.scopeId}`;
  await operationAudit(
    client,
    request,
    row,
    "budget.reservation.released",
    "release",
    fenceVersion,
    state,
    { reason },
  );
  await operationAudit(
    client,
    request,
    row,
    "approval.revoked",
    "approval-revoked",
    fenceVersion,
    state,
    { reason },
  );
  await operationAudit(
    client,
    request,
    row,
    "operation.state.changed",
    "operation-state",
    fenceVersion,
    state,
    {
      previousState: "AWAITING_APPROVAL",
      state: nextState,
      reason,
    },
  );
};

const invalidateAuthorized = async (
  client: PoolClient,
  request: ChangeControlFenceRequest,
  row: ControlOperationRow,
  fenceVersion: number,
  state: ControlState,
  controlEventId: string,
): Promise<void> => {
  const nextState =
    request.scopeType === "SYSTEM" ? "REVALIDATION_REQUIRED" : "REVOKED";
  const operation = await client.query(
    `UPDATE operations SET current_state = $1, version = version + 1, updated_at = now()
     WHERE operation_id = $2 AND current_state = 'AUTHORIZED'`,
    [nextState, row.operation_id],
  );
  if (operation.rowCount !== 1)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      "authorized operation changed during fencing",
    );
  await releaseReservation(client, row);
  const invalidationId = `${request.audit.eventId}:invalidation:${row.authorization_id}`;
  await client.query(
    `INSERT INTO authorization_invalidations
      (invalidation_id, authorization_id, operation_id, control_event_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      invalidationId,
      row.authorization_id,
      row.operation_id,
      controlEventId,
      `control fence ${request.scopeType}:${request.scopeId}`,
    ],
  );
  const reason = `control fence ${request.scopeType}:${request.scopeId}`;
  await operationAudit(
    client,
    request,
    row,
    "budget.reservation.released",
    "authorized-release",
    fenceVersion,
    state,
    {
      authorizationId: row.authorization_id,
      authorizationInvalidationId: invalidationId,
      reason,
    },
  );
  await operationAudit(
    client,
    request,
    row,
    "operation.state.changed",
    "authorized-operation-state",
    fenceVersion,
    state,
    {
      authorizationId: row.authorization_id,
      authorizationInvalidationId: invalidationId,
      previousState: "AUTHORIZED",
      state: nextState,
      reason,
    },
  );
};

const invalidateHeldBeforeApproval = async (
  client: PoolClient,
  request: ChangeControlFenceRequest,
  row: ControlOperationRow,
  fenceVersion: number,
  state: ControlState,
): Promise<void> => {
  const nextState =
    request.scopeType === "SYSTEM" ? "REVALIDATION_REQUIRED" : "REVOKED";
  const operation = await client.query(
    `UPDATE operations SET current_state = $1, version = version + 1, updated_at = now()
     WHERE operation_id = $2 AND current_state IN ('ENVELOPE_FINALIZED', 'AWAITING_APPROVAL')`,
    [nextState, row.operation_id],
  );
  if (operation.rowCount !== 1)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      "held operation changed during fencing",
    );
  await releaseReservation(client, row);
  const reason = `control fence ${request.scopeType}:${request.scopeId}`;
  await operationAudit(
    client,
    request,
    row,
    "budget.reservation.released",
    "held-release",
    fenceVersion,
    state,
    { reason },
  );
  await operationAudit(
    client,
    request,
    row,
    "operation.state.changed",
    "held-operation-state",
    fenceVersion,
    state,
    {
      previousState: row.current_state,
      state: nextState,
      reason,
    },
  );
};

const invalidateAffectedAuthorizations = async (
  client: PoolClient,
  request: ChangeControlFenceRequest,
  fenceVersion: number,
  state: ControlState,
): Promise<void> => {
  const predicate = targetPredicate(request.scopeType);
  const args = request.scopeType === "SYSTEM" ? [] : [request.scopeId];
  const held = await client.query<ControlOperationRow>(
    `SELECT NULL::text AS approval_id, o.operation_id, r.reservation_id, r.budget_id,
            r.amount_atomic, e.envelope_id, e.revision AS envelope_revision, e.envelope_hash,
            pd.decision_id AS policy_decision_id, pd.decision_hash AS policy_decision_hash,
            pd.policy_version, NULL::text AS approver_id, o.operation_id AS nonce,
            NULL::timestamptz AS issued_at, NULL::timestamptz AS expires_at,
            NULL::text AS authorization_id,
            ag.owner_id, o.agent_id, o.wallet_id, o.intent_id, o.policy_id,
            o.current_state, r.status AS reservation_status
     FROM operations o
     JOIN budget_reservations r ON r.operation_id = o.operation_id
     JOIN budget_accounts b ON b.budget_id = r.budget_id
     JOIN agents ag ON ag.agent_id = o.agent_id
     JOIN LATERAL (
       SELECT envelope_id, revision, envelope_hash
       FROM execution_envelopes
       WHERE operation_id = o.operation_id
       ORDER BY revision DESC
       LIMIT 1
     ) e ON TRUE
     JOIN LATERAL (
       SELECT decision_id, decision_hash, policy_version
       FROM policy_decisions
       WHERE operation_id = o.operation_id
       ORDER BY created_at DESC, decision_id DESC
       LIMIT 1
     ) pd ON TRUE
     WHERE o.current_state IN ('ENVELOPE_FINALIZED', 'AWAITING_APPROVAL')
       AND r.status = 'HELD'
       AND NOT EXISTS (
         SELECT 1 FROM approval_requests active
         WHERE active.operation_id = o.operation_id
           AND active.status IN ('PENDING', 'APPROVED')
       )
       AND ${predicate}
     ORDER BY o.operation_id
     FOR UPDATE OF o, r, b`,
    args,
  );
  for (const row of held.rows)
    await invalidateHeldBeforeApproval(
      client,
      request,
      row,
      fenceVersion,
      state,
    );

  const pending = await client.query<ControlOperationRow>(
    `SELECT a.approval_id, a.operation_id, a.reservation_id, r.budget_id,
            r.amount_atomic, a.envelope_id, a.envelope_revision, a.envelope_hash,
            a.policy_decision_id, a.policy_decision_hash, a.policy_version,
            a.approver_id, a.nonce, a.issued_at, a.expires_at,
            NULL::text AS authorization_id,
            ag.owner_id, o.agent_id, o.wallet_id, o.intent_id, o.policy_id,
            o.current_state, r.status AS reservation_status
     FROM approval_requests a
     JOIN operations o ON o.operation_id = a.operation_id
     JOIN budget_reservations r ON r.operation_id = a.operation_id
     JOIN budget_accounts b ON b.budget_id = r.budget_id
     JOIN agents ag ON ag.agent_id = o.agent_id
     WHERE a.status IN ('PENDING', 'APPROVED')
       AND ${predicate}
     ORDER BY a.approval_id
     FOR UPDATE OF a, o, r, b`,
    args,
  );
  for (const row of pending.rows)
    await invalidatePending(client, request, row, fenceVersion, state);

  const authorized = await client.query<ControlOperationRow>(
    `SELECT a.approval_id, a.operation_id, a.reservation_id, r.budget_id,
            r.amount_atomic, a.envelope_id, a.envelope_revision, a.envelope_hash,
            a.policy_decision_id, a.policy_decision_hash, a.policy_version,
            a.approver_id, a.nonce, a.issued_at, a.expires_at,
            e.authorization_id,
            ag.owner_id, o.agent_id, o.wallet_id, o.intent_id, o.policy_id,
            o.current_state, r.status AS reservation_status
     FROM authorization_evidence e
     JOIN approval_requests a ON a.approval_id = e.approval_id
     JOIN operations o ON o.operation_id = e.operation_id
     JOIN budget_reservations r ON r.operation_id = o.operation_id
     JOIN budget_accounts b ON b.budget_id = r.budget_id
     JOIN agents ag ON ag.agent_id = o.agent_id
     LEFT JOIN authorization_invalidations ai ON ai.authorization_id = e.authorization_id
     WHERE ai.authorization_id IS NULL
       AND o.current_state = 'AUTHORIZED'
       AND r.status = 'AUTHORIZED'
       AND ${predicate}
     ORDER BY e.authorization_id
     FOR UPDATE OF e, a, o, r, b`,
    args,
  );
  const controlEventId = `${request.audit.eventId}:fence:${fenceVersion}`;
  for (const row of authorized.rows)
    await invalidateAuthorized(
      client,
      request,
      row,
      fenceVersion,
      state,
      controlEventId,
    );
};

const assertTarget = async (
  client: PoolClient,
  scopeType: ControlScopeType,
  scopeId: string,
): Promise<void> => {
  if (scopeType === "SYSTEM") {
    if (scopeId !== "system")
      throw new ControlFenceError(
        "CONTROL_TARGET_NOT_FOUND",
        "system fence id must be system",
      );
    return;
  }
  const table =
    scopeType === "OWNER"
      ? "owners"
      : scopeType === "AGENT"
        ? "agents"
        : "policies";
  const column =
    scopeType === "OWNER"
      ? "owner_id"
      : scopeType === "AGENT"
        ? "agent_id"
        : "policy_id";
  const result = await client.query(
    `SELECT 1 FROM ${table} WHERE ${column} = $1`,
    [scopeId],
  );
  if (result.rowCount !== 1)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      `${scopeType} does not exist: ${scopeId}`,
    );
};

const ensureFence = async (
  client: PoolClient,
  scopeType: ControlScopeType,
  scopeId: string,
): Promise<ControlRow> => {
  let initialState: ControlState = "ACTIVE";
  let policyStatus: string | null = null;
  if (scopeType === "POLICY") {
    const policy = await client.query<{ status: string }>(
      `SELECT status FROM policies WHERE policy_id = $1`,
      [scopeId],
    );
    policyStatus = policy.rows[0]?.status ?? null;
    if (!policyStatus)
      throw new ControlFenceError(
        "CONTROL_TARGET_NOT_FOUND",
        `POLICY does not exist: ${scopeId}`,
      );
    initialState = policyStatus === "revoked" ? "REVOKED" : "ACTIVE";
  }
  await client.query(
    `INSERT INTO control_fences (scope_type, scope_id, state)
     VALUES ($1, $2, $3)
     ON CONFLICT (scope_type, scope_id) DO NOTHING`,
    [scopeType, scopeId, initialState],
  );
  const result = await client.query<ControlRow>(
    `SELECT scope_type, scope_id, fence_version, state, last_control_event_id
     FROM control_fences
     WHERE scope_type = $1 AND scope_id = $2
     FOR UPDATE`,
    [scopeType, scopeId],
  );
  const row = result.rows[0];
  if (!row)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      "control fence is missing",
    );
  if (
    scopeType === "POLICY" &&
    policyStatus === "revoked" &&
    row.state !== "REVOKED"
  )
    throw new ControlFenceError(
      "AUTHORIZATION_REVALIDATION_REQUIRED",
      `policy status is revoked but its control fence is active: ${scopeId}`,
    );
  return row;
};

const lockMutationFence = async (
  client: PoolClient,
  scopeType: ControlScopeType,
  scopeId: string,
): Promise<ControlRow> => {
  // Mutations use the same prefix of the SYSTEM -> OWNER -> AGENT -> POLICY
  // order used by authorization consumers. This prevents a controller that
  // already owns an AGENT/POLICY row from inverting the consumer lock order.
  const system = await ensureFence(client, "SYSTEM", "system");
  if (scopeType === "SYSTEM") return system;
  if (scopeType === "OWNER") return ensureFence(client, "OWNER", scopeId);

  if (scopeType === "AGENT") {
    const result = await client.query<{ owner_id: string }>(
      `SELECT owner_id FROM agents WHERE agent_id = $1`,
      [scopeId],
    );
    const ownerId = result.rows[0]?.owner_id;
    if (!ownerId)
      throw new ControlFenceError(
        "CONTROL_TARGET_NOT_FOUND",
        `AGENT does not exist: ${scopeId}`,
      );
    await ensureFence(client, "OWNER", ownerId);
    return ensureFence(client, "AGENT", scopeId);
  }

  const result = await client.query<{ owner_id: string; agent_id: string }>(
    `SELECT owner_id, agent_id FROM policies WHERE policy_id = $1`,
    [scopeId],
  );
  const target = result.rows[0];
  if (!target)
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      `POLICY does not exist: ${scopeId}`,
    );
  await ensureFence(client, "OWNER", target.owner_id);
  await ensureFence(client, "AGENT", target.agent_id);
  return ensureFence(client, "POLICY", scopeId);
};

export const lockControlFences = async (
  client: PoolClient,
  ownerId: string,
  agentId: string,
  policyId: string,
): Promise<ControlFenceSnapshot> => {
  // Every authorization path takes these locks in this exact order. Do not
  // parallelize the queries: node-postgres queues one client, but interleaved
  // helper calls would make the lock order implicit and harder to audit.
  const system = await ensureFence(client, "SYSTEM", "system");
  const owner = await ensureFence(client, "OWNER", ownerId);
  const agent = await ensureFence(client, "AGENT", agentId);
  const policy = await ensureFence(client, "POLICY", policyId);
  return {
    systemFenceVersion: Number(system.fence_version),
    systemState: system.state as "ACTIVE" | "PAUSED",
    ownerFenceVersion: Number(owner.fence_version),
    ownerState: owner.state as "ACTIVE" | "REVOKED",
    agentFenceVersion: Number(agent.fence_version),
    agentState: agent.state as "ACTIVE" | "REVOKED",
    policyFenceVersion: Number(policy.fence_version),
    policyState: policy.state as "ACTIVE" | "REVOKED",
  };
};

const appendControlAudit = async (
  client: PoolClient,
  request: ChangeControlFenceRequest,
  row: ControlRow,
  previousState: ControlState,
): Promise<void> => {
  await appendAuditEvent(client, {
    eventId: `${request.audit.eventId}:fence:${row.fence_version}`,
    eventType: eventType(request.scopeType, request.command),
    actorType: request.audit.actorType,
    actorId: request.audit.actorId,
    traceId: request.audit.traceId,
    reservationId: null,
    ownerId: null,
    agentId: null,
    walletId: null,
    intentId: null,
    operationId: null,
    policyId: null,
    policyVersion: null,
    data: {
      scopeType: request.scopeType,
      scopeId: request.scopeId,
      fenceVersion: Number(row.fence_version),
      controlState: row.state,
      previousControlState: previousState,
    },
  });
};

export const changeControlFence = async (
  pool: Pool,
  request: ChangeControlFenceRequest,
): Promise<ControlFenceResult> => {
  id(request.scopeId, "scopeId");
  if (request.scopeType === "SYSTEM" && request.scopeId !== "system")
    throw new ControlFenceError(
      "CONTROL_TARGET_NOT_FOUND",
      "system fence id must be system",
    );
  if (
    request.scopeType === "SYSTEM" &&
    !["PAUSE", "RESUME"].includes(request.command)
  )
    throw new ControlFenceError(
      "INVALID_COMMAND",
      "system supports only pause and resume",
    );
  if (request.scopeType !== "SYSTEM" && request.command !== "REVOKE")
    throw new ControlFenceError(
      "INVALID_COMMAND",
      "owner, agent, and policy fences support only revoke",
    );

  return withSerializableTransaction(pool, async (client) => {
    await assertTarget(client, request.scopeType, request.scopeId);
    const current = await lockMutationFence(
      client,
      request.scopeType,
      request.scopeId,
    );
    const currentVersion = Number(current.fence_version);
    const alreadyApplied =
      (request.command === "PAUSE" && current.state === "PAUSED") ||
      (request.command === "RESUME" && current.state === "ACTIVE") ||
      (request.command === "REVOKE" && current.state === "REVOKED");
    if (alreadyApplied) {
      return {
        scopeType: current.scope_type,
        scopeId: current.scope_id,
        fenceVersion: currentVersion,
        state: current.state,
        changed: false,
      };
    }
    const nextState: ControlState =
      request.scopeType === "SYSTEM"
        ? request.command === "PAUSE"
          ? "PAUSED"
          : "ACTIVE"
        : "REVOKED";
    const updated = await client.query<ControlRow>(
      `UPDATE control_fences
       SET fence_version = fence_version + 1,
           state = $3,
           last_control_event_id = $4,
           updated_at = now()
       WHERE scope_type = $1 AND scope_id = $2
       RETURNING scope_type, scope_id, fence_version, state, last_control_event_id`,
      [
        request.scopeType,
        request.scopeId,
        nextState,
        `${request.audit.eventId}:fence:${currentVersion + 1}`,
      ],
    );
    const next = updated.rows[0];
    if (!next)
      throw new ControlFenceError(
        "CONTROL_TARGET_NOT_FOUND",
        "control fence update failed",
      );
    await appendControlAudit(client, request, next, current.state);
    if (request.scopeType === "POLICY" && request.command === "REVOKE") {
      await client.query(
        `UPDATE policies SET status = 'revoked' WHERE policy_id = $1`,
        [request.scopeId],
      );
    }
    await invalidateAffectedAuthorizations(
      client,
      request,
      Number(next.fence_version),
      next.state,
    );
    return {
      scopeType: next.scope_type,
      scopeId: next.scope_id,
      fenceVersion: Number(next.fence_version),
      state: next.state,
      changed: true,
    };
  });
};

/**
 * Phase-1 pre-execution fence probe. It does not sign or broadcast. A future
 * execution adapter must call an equivalent check in the same transaction or
 * stronger provider boundary immediately before signing.
 */
export const revalidateAuthorization = async (
  pool: Pool,
  request: RevalidateAuthorizationRequest,
): Promise<ControlFenceSnapshot> => {
  id(request.operationId, "operationId");
  id(request.authorizationId, "authorizationId");
  return withSerializableTransaction(pool, async (client) => {
    const identity = await client.query<{
      owner_id: string;
      agent_id: string;
      policy_id: string;
    }>(
      `SELECT ag.owner_id, o.agent_id, o.policy_id
       FROM authorization_evidence e
       JOIN operations o ON o.operation_id = e.operation_id
       JOIN agents ag ON ag.agent_id = o.agent_id
       WHERE e.authorization_id = $1 AND e.operation_id = $2`,
      [request.authorizationId, request.operationId],
    );
    const target = identity.rows[0];
    if (!target)
      throw new ControlFenceError(
        "AUTHORIZATION_REVALIDATION_REQUIRED",
        "authorization evidence is not bound to the requested operation",
      );
    const current = await lockControlFences(
      client,
      target.owner_id,
      target.agent_id,
      target.policy_id,
    );
    const result = await client.query<{
      operation_state: string;
      reservation_status: string;
      invalidation_id: string | null;
      system_fence_version: string | number;
      system_state: "ACTIVE" | "PAUSED";
      owner_fence_version: string | number;
      owner_state: "ACTIVE" | "REVOKED";
      agent_fence_version: string | number;
      agent_state: "ACTIVE" | "REVOKED";
      policy_fence_version: string | number;
      policy_state: "ACTIVE" | "REVOKED";
      authorization_expires_at: Date | string;
    }>(
      `SELECT o.current_state AS operation_state, r.status AS reservation_status,
              ai.invalidation_id,
              e.system_fence_version, e.system_state,
              e.owner_fence_version, e.owner_state,
              e.agent_fence_version, e.agent_state,
              e.policy_fence_version, e.policy_state,
              e.expires_at AS authorization_expires_at
       FROM authorization_evidence e
       JOIN operations o ON o.operation_id = e.operation_id
       JOIN budget_reservations r ON r.operation_id = e.operation_id
       JOIN budget_accounts b ON b.budget_id = r.budget_id
       LEFT JOIN authorization_invalidations ai ON ai.authorization_id = e.authorization_id
       WHERE e.authorization_id = $1 AND e.operation_id = $2
         AND e.expires_at > now()
       FOR UPDATE OF e, o, r, b`,
      [request.authorizationId, request.operationId],
    );
    const row = result.rows[0];
    const matches =
      row &&
      row.operation_state === "AUTHORIZED" &&
      row.reservation_status === "AUTHORIZED" &&
      new Date(row.authorization_expires_at).getTime() > Date.now() &&
      row.invalidation_id === null &&
      row.system_state === current.systemState &&
      row.owner_state === current.ownerState &&
      row.agent_state === current.agentState &&
      row.policy_state === current.policyState &&
      Number(row.system_fence_version) === current.systemFenceVersion &&
      Number(row.owner_fence_version) === current.ownerFenceVersion &&
      Number(row.agent_fence_version) === current.agentFenceVersion &&
      Number(row.policy_fence_version) === current.policyFenceVersion &&
      current.systemState === "ACTIVE" &&
      current.ownerState === "ACTIVE" &&
      current.agentState === "ACTIVE" &&
      current.policyState === "ACTIVE";
    if (!matches)
      throw new ControlFenceError(
        "AUTHORIZATION_REVALIDATION_REQUIRED",
        "authorization fence is stale or inactive",
      );
    return current;
  });
};
