import { createHash } from "node:crypto";

import { appendAuditEvent, type AuditEventType } from "@crip/audit";
import type { Pool, PoolClient } from "pg";

import type {
  BroadcastAttempt,
  BroadcastStore,
  DurableSignedTransaction,
} from "./broadcast-core.js";

type AttemptRow = Record<string, string | number | null> & {
  status: BroadcastAttempt["status"];
};

type AuthorityRow = {
  operation_state: string;
  agent_id: string;
  owner_id: string;
  policy_id: string;
  policy_version: number;
  authorization_id: string;
  authorization_kind: "OWNER_APPROVAL" | "AUTONOMOUS_POLICY";
  approval_id: string | null;
  owner_authentication_id: string | null;
  approval_status: string | null;
  approval_approver_id: string | null;
  approval_consumed_at: string | null;
  policy_decision_id: string;
  policy_decision_hash: string;
  policy_decision_status: string;
  persisted_policy_decision_hash: string;
  decision_policy_id: string;
  decision_policy_version: number;
  authorization_policy_id: string;
  authorization_policy_version: number;
  policy_status: string;
  reservation_id: string;
  reservation_status: string;
  reservation_live: boolean;
  envelope_id: string;
  envelope_revision: number;
  envelope_hash: string;
  envelope_live: boolean;
  envelope_current: boolean;
  simulation_fixture_id: string;
  fixture_instance_id: string;
  fixture_current: boolean;
  signer_credential_id: string;
  signer_component_id: string;
  credential_component_id: string;
  credential_role: string;
  credential_status: string;
  invalidation_id: string | null;
  system_fence_version: string;
  system_state: string;
  owner_fence_version: string;
  owner_state: string;
  agent_fence_version: string;
  agent_state: string;
  policy_fence_version: string;
  policy_state: string;
  auth_system_fence_version: string;
  auth_system_state: string;
  auth_owner_fence_version: string;
  auth_owner_state: string;
  auth_agent_fence_version: string;
  auth_agent_state: string;
  auth_policy_fence_version: string;
  auth_policy_state: string;
  signed_transaction_id: string;
  signed_operation_id: string;
  signed_reservation_id: string;
  signed_envelope_id: string;
  signed_envelope_revision: number;
  signed_envelope_hash: string;
  signed_authorization_id: string;
  signed_fixture_instance_id: string;
  signed_expected_transaction_hash: string;
  signed_simulation_id: string;
  durable_simulation_id: string;
};

type AuditRow = {
  attempt_id: string;
  signed_transaction_id: string;
  operation_id: string;
  reservation_id: string;
  authorization_id: string;
  envelope_id: string;
  envelope_revision: number | string;
  envelope_hash: string;
  fixture_instance_id: string;
  expected_transaction_hash: string;
  status: BroadcastAttempt["status"];
  response_transaction_hash: string | null;
  classification_reason: string | null;
  signer_credential_id: string;
  signer_component_id: string;
  owner_id: string;
  agent_id: string;
  wallet_id: string;
  intent_id: string;
  policy_id: string;
  policy_version: number;
  budget_id: string;
};

const attemptFromRow = (row: AttemptRow): BroadcastAttempt => ({
  attemptId: String(row.attempt_id),
  signedTransactionId: String(row.signed_transaction_id),
  operationId: String(row.operation_id),
  reservationId: String(row.reservation_id),
  envelopeId: String(row.envelope_id),
  envelopeRevision: Number(row.envelope_revision),
  envelopeHash: String(row.envelope_hash),
  authorizationId: String(row.authorization_id),
  fixtureInstanceId: String(row.fixture_instance_id),
  expectedTransactionHash: String(row.expected_transaction_hash),
  status: row.status,
  responseTransactionHash:
    row.response_transaction_hash === null
      ? null
      : String(row.response_transaction_hash),
  classificationReason:
    row.classification_reason === null
      ? null
      : String(row.classification_reason),
});

const withClient = async <T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
};

const attemptColumns = `attempt_id, signed_transaction_id, operation_id, reservation_id,
  envelope_id, envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
  expected_transaction_hash, status, response_transaction_hash, classification_reason`;

const sameSignedBinding = (
  row: BroadcastAttempt,
  signed: DurableSignedTransaction,
): boolean =>
  row.signedTransactionId === signed.signedTransactionId &&
  row.operationId === signed.operationId &&
  row.reservationId === signed.reservationId &&
  row.envelopeId === signed.envelopeId &&
  row.envelopeRevision === signed.envelopeRevision &&
  row.envelopeHash === signed.envelopeHash &&
  row.authorizationId === signed.authorizationId &&
  row.fixtureInstanceId === signed.fixtureInstanceId &&
  row.expectedTransactionHash === signed.expectedTransactionHash;

const attemptAuditEventType = (
  status: BroadcastAttempt["status"],
): AuditEventType => {
  switch (status) {
    case "STARTED":
      return "transaction.broadcast.attempted";
    case "ACCEPTED":
      return "transaction.broadcast.accepted";
    case "REJECTED":
      return "transaction.broadcast.rejected";
    case "UNKNOWN":
      return "transaction.broadcast.unknown";
    case "CONFLICT":
      return "transaction.confirmation.mismatch";
  }
};

const appendAttemptAudit = async (
  client: PoolClient,
  attempt: BroadcastAttempt,
  traceId: string,
): Promise<void> => {
  if (!/^[0-9a-f]{32}$/.test(traceId))
    throw new Error("broadcast trace identity is invalid");
  const result = await client.query<AuditRow>(
    `SELECT a.attempt_id, a.signed_transaction_id, a.operation_id,
            a.reservation_id, a.authorization_id, a.envelope_id,
            a.envelope_revision, a.envelope_hash, a.fixture_instance_id,
            a.expected_transaction_hash, a.status, a.response_transaction_hash,
            a.classification_reason, s.signer_credential_id,
            s.signer_component_id, w.owner_id, o.agent_id, o.wallet_id,
            o.intent_id, o.policy_id, o.policy_version, r.budget_id
     FROM broadcast_attempts a
     JOIN signed_transactions s
       ON s.signed_transaction_id = a.signed_transaction_id
     JOIN operations o ON o.operation_id = a.operation_id
     JOIN wallets w ON w.wallet_id = o.wallet_id
     JOIN budget_reservations r
       ON r.operation_id = a.operation_id
      AND r.reservation_id = a.reservation_id
     WHERE a.attempt_id = $1`,
    [attempt.attemptId],
  );
  const row = result.rows[0];
  if (!row || row.status !== attempt.status)
    throw new Error("broadcast attempt audit binding is missing");
  await appendAuditEvent(client, {
    eventId: `evt:broadcast:${createHash("sha256")
      .update(`${row.attempt_id}:${row.status}`)
      .digest("hex")}`,
    actorType: "adapter",
    actorId: row.signer_component_id,
    traceId,
    reservationId: row.reservation_id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    walletId: row.wallet_id,
    intentId: row.intent_id,
    operationId: row.operation_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    eventType: attemptAuditEventType(row.status),
    data: {
      reservationId: row.reservation_id,
      authorizationId: row.authorization_id,
      envelopeId: row.envelope_id,
      envelopeRevision: Number(row.envelope_revision),
      envelopeHash: row.envelope_hash,
      transactionHash: row.expected_transaction_hash,
      attemptId: row.attempt_id,
      signedTransactionId: row.signed_transaction_id,
      attemptStatus: row.status,
      fixtureInstanceId: row.fixture_instance_id,
      credentialId: row.signer_credential_id,
      componentId: row.signer_component_id,
      componentRole: "ADAPTER",
      authenticationMethod: "ed25519",
      adapterId: "local-anvil",
      chainId: "eip155:31337",
      ...(row.classification_reason === null
        ? {}
        : { reasonCode: row.classification_reason }),
      ...(row.status === "CONFLICT" && row.response_transaction_hash
        ? { candidateHash: row.response_transaction_hash }
        : {}),
    },
  });
};

const validCurrentAuthority = (
  row: AuthorityRow | undefined,
  signed: DurableSignedTransaction,
): boolean => {
  if (!row) return false;
  const ownerApproval =
    row.authorization_kind === "OWNER_APPROVAL" &&
    row.policy_decision_status === "REQUIRE_APPROVAL" &&
    row.approval_id !== null &&
    row.owner_authentication_id !== null &&
    row.approval_status === "CONSUMED" &&
    row.approval_approver_id !== null &&
    row.approval_consumed_at !== null;
  const autonomous =
    row.authorization_kind === "AUTONOMOUS_POLICY" &&
    row.policy_decision_status === "ALLOW_AUTONOMOUS" &&
    row.approval_id === null &&
    row.owner_authentication_id === null &&
    row.approval_status === null &&
    row.approval_approver_id === null &&
    row.approval_consumed_at === null;
  return (
    (ownerApproval || autonomous) &&
    row.operation_state === "SIGNED" &&
    row.reservation_status === "AUTHORIZED" &&
    row.reservation_live &&
    row.envelope_live &&
    row.envelope_current &&
    row.invalidation_id === null &&
    row.policy_status === "active" &&
    row.persisted_policy_decision_hash === row.policy_decision_hash &&
    row.decision_policy_id === row.policy_id &&
    row.decision_policy_version === row.policy_version &&
    row.authorization_policy_id === row.policy_id &&
    row.authorization_policy_version === row.policy_version &&
    row.authorization_id === signed.authorizationId &&
    row.reservation_id === signed.reservationId &&
    row.envelope_id === signed.envelopeId &&
    row.envelope_revision === signed.envelopeRevision &&
    row.envelope_hash === signed.envelopeHash &&
    row.signed_transaction_id === signed.signedTransactionId &&
    row.signed_operation_id === signed.operationId &&
    row.signed_reservation_id === signed.reservationId &&
    row.signed_envelope_id === signed.envelopeId &&
    row.signed_envelope_revision === signed.envelopeRevision &&
    row.signed_envelope_hash === signed.envelopeHash &&
    row.signed_authorization_id === signed.authorizationId &&
    row.signed_fixture_instance_id === signed.fixtureInstanceId &&
    row.signed_expected_transaction_hash === signed.expectedTransactionHash &&
    row.signed_simulation_id === row.durable_simulation_id &&
    row.simulation_fixture_id === signed.fixtureInstanceId &&
    row.fixture_instance_id === signed.fixtureInstanceId &&
    row.fixture_current &&
    row.signer_credential_id.length > 0 &&
    row.signer_component_id === row.credential_component_id &&
    row.credential_role === "ADAPTER" &&
    row.credential_status === "ACTIVE" &&
    row.system_state === "ACTIVE" &&
    row.owner_state === "ACTIVE" &&
    row.agent_state === "ACTIVE" &&
    row.policy_state === "ACTIVE" &&
    row.auth_system_state === "ACTIVE" &&
    row.auth_owner_state === "ACTIVE" &&
    row.auth_agent_state === "ACTIVE" &&
    row.auth_policy_state === "ACTIVE" &&
    row.system_fence_version === row.auth_system_fence_version &&
    row.owner_fence_version === row.auth_owner_fence_version &&
    row.agent_fence_version === row.auth_agent_fence_version &&
    row.policy_fence_version === row.auth_policy_fence_version
  );
};

export interface BroadcastStoreBarriers {
  /** Test-only deterministic barrier after the shared reservation lock. */
  afterReservationLocked?: () => Promise<void>;
}

export const createBroadcastStore = (
  pool: Pool,
  barriers: BroadcastStoreBarriers = {},
): BroadcastStore => ({
  findSignedTransaction: (signedTransactionId) =>
    withClient(pool, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT signed_transaction_id, operation_id, reservation_id, envelope_id,
                envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
                expected_transaction_hash FROM signed_transactions WHERE signed_transaction_id = $1`,
        [signedTransactionId],
      );
      const row = result.rows[0];
      return row
        ? ({
            signedTransactionId: String(row.signed_transaction_id),
            operationId: String(row.operation_id),
            reservationId: String(row.reservation_id),
            envelopeId: String(row.envelope_id),
            envelopeRevision: Number(row.envelope_revision),
            envelopeHash: String(row.envelope_hash),
            authorizationId: String(row.authorization_id),
            fixtureInstanceId: String(row.fixture_instance_id),
            expectedTransactionHash: String(row.expected_transaction_hash),
          } satisfies DurableSignedTransaction)
        : null;
    }),

  startBroadcastAttempt: (signed, attemptId, traceId) =>
    withClient(pool, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '5s'");
        const identity = await client.query<{
          operation_id: string;
          reservation_id: string;
          envelope_id: string;
          envelope_revision: number;
          envelope_hash: string;
          authorization_id: string;
          policy_decision_id: string;
          fixture_instance_id: string;
          expected_transaction_hash: string;
          simulation_id: string;
          owner_id: string;
          agent_id: string;
          policy_id: string;
        }>(
          `SELECT s.operation_id, s.reservation_id, s.envelope_id,
                  s.envelope_revision, s.envelope_hash, s.authorization_id,
                  ae.policy_decision_id, s.fixture_instance_id,
                  s.expected_transaction_hash, s.simulation_id,
                  w.owner_id, o.agent_id, o.policy_id
           FROM signed_transactions s
           JOIN operations o ON o.operation_id = s.operation_id
           JOIN wallets w ON w.wallet_id = o.wallet_id
           JOIN authorization_evidence ae
             ON ae.operation_id = s.operation_id
            AND ae.authorization_id = s.authorization_id
           WHERE s.signed_transaction_id = $1`,
          [signed.signedTransactionId],
        );
        const binding = identity.rows[0];
        if (
          !binding ||
          binding.operation_id !== signed.operationId ||
          binding.reservation_id !== signed.reservationId ||
          binding.envelope_id !== signed.envelopeId ||
          binding.envelope_revision !== signed.envelopeRevision ||
          binding.envelope_hash !== signed.envelopeHash ||
          binding.authorization_id !== signed.authorizationId ||
          binding.fixture_instance_id !== signed.fixtureInstanceId ||
          binding.expected_transaction_hash !== signed.expectedTransactionHash
        )
          throw new Error(
            "signed transaction does not match durable authority",
          );

        for (const [scopeType, scopeId] of [
          ["SYSTEM", "system"],
          ["OWNER", binding.owner_id],
          ["AGENT", binding.agent_id],
          ["POLICY", binding.policy_id],
        ]) {
          const fence = await client.query(
            `SELECT 1 FROM control_fences
             WHERE scope_type = $1 AND scope_id = $2 FOR UPDATE`,
            [scopeType, scopeId],
          );
          if (fence.rowCount !== 1)
            throw new Error("current control fence is missing");
        }

        const existing = await client.query<AttemptRow>(
          `SELECT ${attemptColumns} FROM broadcast_attempts
           WHERE attempt_id = $1 OR signed_transaction_id = $2`,
          [attemptId, signed.signedTransactionId],
        );
        if (existing.rows.length > 1)
          throw new Error(
            "broadcast attempt identity is already bound elsewhere",
          );
        if (existing.rows[0]) {
          const attempt = attemptFromRow(existing.rows[0]);
          if (
            attempt.attemptId === attemptId &&
            attempt.signedTransactionId !== signed.signedTransactionId
          )
            throw new Error(
              "broadcast attempt identity is already bound elsewhere",
            );
          if (!sameSignedBinding(attempt, signed))
            throw new Error(
              "broadcast attempt does not match durable authority",
            );
          await client.query("COMMIT");
          return { attempt, created: false };
        }

        const decision = await client.query<{ decision_id: string }>(
          `SELECT decision_id FROM policy_decisions
           WHERE operation_id = $1 AND decision_id = $2 FOR UPDATE`,
          [signed.operationId, binding.policy_decision_id],
        );
        if (decision.rowCount !== 1)
          throw new Error("canonical authorization policy decision is missing");
        const lockedAuthorization = await client.query<{
          authorization_id: string;
        }>(
          `SELECT authorization_id FROM authorization_evidence
           WHERE operation_id = $1 AND authorization_id = $2
             AND reservation_id = $3 AND envelope_id = $4
             AND envelope_revision = $5 AND envelope_hash = $6
             AND policy_decision_id = $7
           FOR UPDATE`,
          [
            signed.operationId,
            signed.authorizationId,
            signed.reservationId,
            signed.envelopeId,
            signed.envelopeRevision,
            signed.envelopeHash,
            binding.policy_decision_id,
          ],
        );
        if (lockedAuthorization.rowCount !== 1)
          throw new Error("canonical authorization evidence is missing");
        const operation = await client.query(
          "SELECT operation_id FROM operations WHERE operation_id = $1 FOR UPDATE",
          [signed.operationId],
        );
        if (operation.rowCount !== 1)
          throw new Error("canonical operation is missing");
        const reservation = await client.query(
          `SELECT reservation_id FROM budget_reservations
           WHERE operation_id = $1 AND reservation_id = $2 FOR UPDATE`,
          [signed.operationId, signed.reservationId],
        );
        if (reservation.rowCount !== 1)
          throw new Error("canonical reservation is missing");
        await barriers.afterReservationLocked?.();
        const envelope = await client.query(
          `SELECT envelope_id FROM execution_envelopes
           WHERE operation_id = $1 AND envelope_id = $2
             AND revision = $3 AND envelope_hash = $4 FOR UPDATE`,
          [
            signed.operationId,
            signed.envelopeId,
            signed.envelopeRevision,
            signed.envelopeHash,
          ],
        );
        if (envelope.rowCount !== 1)
          throw new Error("canonical envelope is missing");
        const simulation = await client.query(
          `SELECT simulation_id FROM transaction_simulations
           WHERE operation_id = $1 AND simulation_id = $2 FOR UPDATE`,
          [signed.operationId, binding.simulation_id],
        );
        if (simulation.rowCount !== 1)
          throw new Error("canonical simulation is missing");
        const lockedSigned = await client.query(
          `SELECT signed_transaction_id FROM signed_transactions
           WHERE signed_transaction_id = $1 FOR UPDATE`,
          [signed.signedTransactionId],
        );
        if (lockedSigned.rowCount !== 1)
          throw new Error("durable signed evidence is missing");
        const credential = await client.query(
          `SELECT credential_id FROM trusted_component_credentials
           WHERE credential_id = (
             SELECT signer_credential_id FROM signed_transactions
             WHERE signed_transaction_id = $1
           ) FOR SHARE`,
          [signed.signedTransactionId],
        );
        if (credential.rowCount !== 1)
          throw new Error("signer credential is missing");

        const authority = await client.query<AuthorityRow>(
          `SELECT o.current_state AS operation_state, o.agent_id, w.owner_id,
                  o.policy_id, o.policy_version,
                  ae.authorization_id, ae.authorization_kind, ae.approval_id,
                  ae.owner_authentication_id, approval.status AS approval_status,
                  approval.approver_id AS approval_approver_id,
                  approval.consumed_at::text AS approval_consumed_at,
                  ae.policy_decision_id, ae.policy_decision_hash,
                  pd.decision AS policy_decision_status,
                  pd.decision_hash AS persisted_policy_decision_hash,
                  pd.policy_id AS decision_policy_id,
                  pd.policy_version AS decision_policy_version,
                  ae.policy_id AS authorization_policy_id,
                  ae.policy_version AS authorization_policy_version,
                  p.status AS policy_status,
                  ae.reservation_id, br.status AS reservation_status,
                  br.expires_at > clock_timestamp() AS reservation_live,
                  ae.envelope_id, ae.envelope_revision, ae.envelope_hash,
                  (e.payload ->> 'expiresAt')::timestamptz > clock_timestamp()
                    AS envelope_live,
                  NOT EXISTS (
                    SELECT 1 FROM execution_envelopes newer
                    WHERE newer.operation_id = e.operation_id
                      AND newer.revision > e.revision
                  ) AS envelope_current,
                  sim.fixture_instance_id AS simulation_fixture_id,
                  f.fixture_instance_id, f.is_current AS fixture_current,
                  s.signer_credential_id, s.signer_component_id,
                  c.component_id AS credential_component_id,
                  c.component_role AS credential_role, c.status AS credential_status,
                  ai.invalidation_id,
                  system_fence.fence_version::text AS system_fence_version,
                  system_fence.state AS system_state,
                  owner_fence.fence_version::text AS owner_fence_version,
                  owner_fence.state AS owner_state,
                  agent_fence.fence_version::text AS agent_fence_version,
                  agent_fence.state AS agent_state,
                  policy_fence.fence_version::text AS policy_fence_version,
                  policy_fence.state AS policy_state,
                  ae.system_fence_version::text AS auth_system_fence_version,
                  ae.system_state AS auth_system_state,
                  ae.owner_fence_version::text AS auth_owner_fence_version,
                  ae.owner_state AS auth_owner_state,
                  ae.agent_fence_version::text AS auth_agent_fence_version,
                  ae.agent_state AS auth_agent_state,
                  ae.policy_fence_version::text AS auth_policy_fence_version,
                  ae.policy_state AS auth_policy_state,
                  s.signed_transaction_id, s.operation_id AS signed_operation_id,
                  s.reservation_id AS signed_reservation_id,
                  s.envelope_id AS signed_envelope_id,
                  s.envelope_revision AS signed_envelope_revision,
                  s.envelope_hash AS signed_envelope_hash,
                  s.authorization_id AS signed_authorization_id,
                  s.fixture_instance_id AS signed_fixture_instance_id,
                  s.expected_transaction_hash AS signed_expected_transaction_hash,
                  s.simulation_id AS signed_simulation_id,
                  sim.simulation_id AS durable_simulation_id
           FROM signed_transactions s
           JOIN operations o ON o.operation_id = s.operation_id
           JOIN wallets w ON w.wallet_id = o.wallet_id
           JOIN authorization_evidence ae
             ON ae.operation_id = s.operation_id
            AND ae.authorization_id = s.authorization_id
           JOIN budget_reservations br
             ON br.operation_id = s.operation_id
            AND br.reservation_id = s.reservation_id
           JOIN execution_envelopes e
             ON e.operation_id = s.operation_id
            AND e.envelope_id = s.envelope_id
            AND e.revision = s.envelope_revision
            AND e.envelope_hash = s.envelope_hash
           JOIN transaction_simulations sim
             ON sim.operation_id = s.operation_id
            AND sim.simulation_id = s.simulation_id
            AND sim.evidence_hash = e.payload ->> 'simulationResultHash'
           JOIN local_chain_fixtures f
             ON f.fixture_instance_id = s.fixture_instance_id
           JOIN trusted_component_credentials c
             ON c.credential_id = s.signer_credential_id
           JOIN control_fences system_fence
             ON system_fence.scope_type = 'SYSTEM'
            AND system_fence.scope_id = 'system'
           JOIN control_fences owner_fence
             ON owner_fence.scope_type = 'OWNER'
            AND owner_fence.scope_id = w.owner_id
           JOIN control_fences agent_fence
             ON agent_fence.scope_type = 'AGENT'
            AND agent_fence.scope_id = o.agent_id
           JOIN control_fences policy_fence
             ON policy_fence.scope_type = 'POLICY'
            AND policy_fence.scope_id = o.policy_id
           JOIN policies p ON p.policy_id = o.policy_id
           LEFT JOIN authorization_invalidations ai
             ON ai.authorization_id = ae.authorization_id
           LEFT JOIN policy_decisions pd
             ON pd.operation_id = ae.operation_id
            AND pd.decision_id = ae.policy_decision_id
           LEFT JOIN approval_requests approval
             ON approval.approval_id = ae.approval_id
           WHERE s.signed_transaction_id = $1
             AND ae.expires_at > clock_timestamp()`,
          [signed.signedTransactionId],
        );
        if (!validCurrentAuthority(authority.rows[0], signed))
          throw new Error("canonical signing authority is stale or invalid");

        const inserted = await client.query(
          `INSERT INTO broadcast_attempts
            (attempt_id, signed_transaction_id, operation_id, reservation_id,
             envelope_id, envelope_revision, envelope_hash, authorization_id,
             fixture_instance_id, expected_transaction_hash)
           SELECT $1, signed_transaction_id, operation_id, reservation_id,
                  envelope_id, envelope_revision, envelope_hash, authorization_id,
                  fixture_instance_id, expected_transaction_hash
           FROM signed_transactions WHERE signed_transaction_id = $2
           ON CONFLICT DO NOTHING`,
          [attemptId, signed.signedTransactionId],
        );
        const rows = await client.query<AttemptRow>(
          `SELECT ${attemptColumns} FROM broadcast_attempts
           WHERE attempt_id = $1 OR signed_transaction_id = $2`,
          [attemptId, signed.signedTransactionId],
        );
        if (rows.rows.length !== 1)
          throw new Error("broadcast attempt was not persisted uniquely");
        const attempt = attemptFromRow(rows.rows[0]!);
        if (!sameSignedBinding(attempt, signed))
          throw new Error("broadcast attempt does not match durable authority");
        const created = inserted.rowCount === 1;
        if (created) await appendAttemptAudit(client, attempt, traceId);
        await client.query("COMMIT");
        return { attempt, created };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }),

  finishBroadcastAttempt: (input) =>
    withClient(pool, async (client) => {
      await client.query("BEGIN");
      try {
        const existing = await client.query<AttemptRow>(
          `SELECT ${attemptColumns} FROM broadcast_attempts
           WHERE attempt_id = $1 FOR UPDATE`,
          [input.attemptId],
        );
        if (!existing.rows[0]) throw new Error("broadcast attempt not found");
        if (existing.rows[0].status !== "STARTED") {
          await client.query("COMMIT");
          return attemptFromRow(existing.rows[0]);
        }
        const result = await client.query<AttemptRow>(
          `UPDATE broadcast_attempts SET status = $2,
             response_transaction_hash = $3, classification_reason = $4,
             completed_at = clock_timestamp()
           WHERE attempt_id = $1 AND status = 'STARTED'
           RETURNING ${attemptColumns}`,
          [
            input.attemptId,
            input.status,
            input.responseTransactionHash,
            input.classificationReason,
          ],
        );
        const attempt = result.rows[0];
        if (!attempt) throw new Error("broadcast attempt was not completed");
        await appendAttemptAudit(
          client,
          attemptFromRow(attempt),
          input.traceId,
        );
        await client.query("COMMIT");
        return attemptFromRow(attempt);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }),
});
