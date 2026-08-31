import { randomUUID } from "node:crypto";

import { appendAuditEvent } from "@crip/audit";
import type { Pool, PoolClient } from "pg";

import type {
  SignAuthorizedTransferIds,
  SignerStore,
  SigningContext,
  SimulationRecord,
} from "./signer-core.js";

interface ContextRow {
  operation_state: string;
  intent_id: string;
  agent_id: string;
  wallet_id: string;
  owner_id: string;
  policy_id: string;
  policy_version: string | number;
  intent_payload: unknown;
  policy_document: unknown;
  auth_reservation_id: string | null;
  auth_envelope_id: string | null;
  auth_envelope_revision: string | number | null;
  auth_envelope_hash: string | null;
  auth_expires_at: string | null;
  auth_invalidations: string;
  auth_system_fence_version: string | null;
  auth_system_state: string | null;
  auth_owner_fence_version: string | null;
  auth_owner_state: string | null;
  auth_agent_fence_version: string | null;
  auth_agent_state: string | null;
  auth_policy_fence_version: string | null;
  auth_policy_state: string | null;
  envelope_payload: unknown;
  envelope_hash: string | null;
  envelope_revision: string | number | null;
  latest_envelope_revision: string | null;
  reservation_status: string | null;
  reservation_expires_at: string | null;
  credential_component_id: string | null;
  credential_role: string | null;
  credential_status: string | null;
  fixture_instance_id: string | null;
  fixture_token_address: string | null;
}

interface SimulationRow {
  simulation_id: string;
  transfer_core_candidate_hash: string;
  fixture_instance_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  sender_address: string;
  sender_nonce: string;
  token_balance_atomic: string;
  native_balance_wei: string;
  gas_estimate: string;
  gas_limit: string;
  base_fee_per_gas: string;
  max_priority_fee_per_gas: string;
  max_fee_per_gas: string;
  outcome: string;
  expected_asset_deltas: unknown;
  maximum_native_fee_atomic: string;
  simulator_version: string;
  evidence_hash: string;
}

interface SigningAuthorityRow {
  operation_state: string;
  operation_id: string;
  intent_id: string;
  agent_id: string;
  wallet_id: string;
  owner_id: string;
  policy_id: string;
  policy_version: string | number;
  reservation_id: string;
  envelope_id: string;
  envelope_revision: string | number;
  envelope_hash: string;
  authorization_id: string;
  authorization_expires_at: Date | string;
  reservation_status: string;
  invalidation_id: string | null;
  system_fence_version: string;
  system_state: string;
  owner_fence_version: string;
  owner_state: string;
  agent_fence_version: string;
  agent_state: string;
  policy_fence_version: string;
  policy_state: string;
}

const numeric = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

const atomic = (value: string | number): string => String(value);

/** Convert one `transaction_simulations` row to its normalized shape. */
const simulationRecord = (row: SimulationRow): SimulationRecord => ({
  simulationId: row.simulation_id,
  transferCoreCandidateHash: row.transfer_core_candidate_hash,
  fixtureInstanceId: row.fixture_instance_id,
  chainId: row.chain_id,
  blockNumber: atomic(row.block_number),
  blockHash: row.block_hash,
  senderAddress: row.sender_address,
  senderNonce: atomic(row.sender_nonce),
  tokenBalanceAtomic: atomic(row.token_balance_atomic),
  nativeBalanceWei: atomic(row.native_balance_wei),
  gasEstimate: atomic(row.gas_estimate),
  gasLimit: atomic(row.gas_limit),
  baseFeePerGas: atomic(row.base_fee_per_gas),
  maxPriorityFeePerGas: atomic(row.max_priority_fee_per_gas),
  maxFeePerGas: atomic(row.max_fee_per_gas),
  outcome: row.outcome,
  expectedAssetDeltas: row.expected_asset_deltas,
  maximumNativeFeeAtomic: atomic(row.maximum_native_fee_atomic),
  simulatorVersion: row.simulator_version,
  evidenceHash: row.evidence_hash,
});

/**
 * Load the single signer view of trusted state. Every column is resolved from
 * PostgreSQL by key, never from the caller-supplied request.
 */
const loadContext = async (
  client: PoolClient,
  ids: SignAuthorizedTransferIds,
  credentialId: string,
): Promise<SigningContext | null> => {
  const result = await client.query<ContextRow>(
    `SELECT
       o.current_state AS operation_state,
       o.intent_id, o.agent_id, o.wallet_id, o.policy_id, o.policy_version,
       i.payload AS intent_payload,
       w.owner_id,
       pv.document AS policy_document,
       ae.reservation_id AS auth_reservation_id,
       ae.envelope_id AS auth_envelope_id,
       ae.envelope_revision AS auth_envelope_revision,
       ae.envelope_hash AS auth_envelope_hash,
       ae.expires_at::text AS auth_expires_at,
       (SELECT count(*)::text FROM authorization_invalidations ai
          WHERE ai.authorization_id = ae.authorization_id) AS auth_invalidations,
       ae.system_fence_version::text AS auth_system_fence_version,
       ae.system_state AS auth_system_state,
       ae.owner_fence_version::text AS auth_owner_fence_version,
       ae.owner_state AS auth_owner_state,
       ae.agent_fence_version::text AS auth_agent_fence_version,
       ae.agent_state AS auth_agent_state,
       ae.policy_fence_version::text AS auth_policy_fence_version,
       ae.policy_state AS auth_policy_state,
       e.payload AS envelope_payload,
       e.envelope_hash AS envelope_hash,
       e.revision AS envelope_revision,
       (SELECT max(revision)::text FROM execution_envelopes newer
          WHERE newer.operation_id = o.operation_id) AS latest_envelope_revision,
       br.status AS reservation_status,
       br.expires_at::text AS reservation_expires_at,
       tc.component_id AS credential_component_id,
       tc.component_role AS credential_role,
       tc.status AS credential_status,
       f.fixture_instance_id AS fixture_instance_id,
       f.token_address AS fixture_token_address
     FROM operations o
     JOIN intents i ON i.intent_id = o.intent_id
     JOIN wallets w ON w.wallet_id = o.wallet_id
     JOIN policy_versions pv ON pv.policy_id = o.policy_id AND pv.version = o.policy_version
     LEFT JOIN authorization_evidence ae
       ON ae.authorization_id = $2 AND ae.operation_id = o.operation_id
     LEFT JOIN execution_envelopes e
       ON e.operation_id = ae.operation_id AND e.envelope_id = ae.envelope_id
     LEFT JOIN budget_reservations br ON br.reservation_id = ae.reservation_id
     LEFT JOIN trusted_component_credentials tc ON tc.credential_id = $3
     LEFT JOIN local_chain_fixtures f ON f.is_current
     WHERE o.operation_id = $1`,
    [ids.operationId, ids.authorizationId, credentialId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const fences = await client.query<{
    scope_type: "SYSTEM" | "OWNER" | "AGENT" | "POLICY";
    state: string;
    fence_version: string;
  }>(
    `SELECT cf.scope_type, cf.state, cf.fence_version::text AS fence_version
     FROM control_fences cf
     WHERE (cf.scope_type, cf.scope_id) IN (
       ('SYSTEM', 'system'), ('OWNER', $1), ('AGENT', $2), ('POLICY', $3)
     )`,
    [row.owner_id, row.agent_id, row.policy_id],
  );

  const simulations = await client.query<SimulationRow>(
    `SELECT simulation_id, transfer_core_candidate_hash, fixture_instance_id,
            chain_id, block_number::text AS block_number, block_hash,
            sender_address, sender_nonce::text AS sender_nonce,
            token_balance_atomic::text AS token_balance_atomic,
            native_balance_wei::text AS native_balance_wei,
            gas_estimate::text AS gas_estimate, gas_limit::text AS gas_limit,
            base_fee_per_gas::text AS base_fee_per_gas,
            max_priority_fee_per_gas::text AS max_priority_fee_per_gas,
            max_fee_per_gas::text AS max_fee_per_gas, outcome,
            expected_asset_deltas, maximum_native_fee_atomic::text AS maximum_native_fee_atomic,
            simulator_version, evidence_hash
     FROM transaction_simulations
     WHERE operation_id = $1`,
    [ids.operationId],
  );

  const simulationRecords = simulations.rows.map(simulationRecord);
  const fixture =
    row.fixture_instance_id === null || row.fixture_token_address === null
      ? null
      : {
          fixtureInstanceId: row.fixture_instance_id,
          tokenAddress: row.fixture_token_address,
        };

  return {
    operation: {
      state: row.operation_state,
      intentId: row.intent_id,
      agentId: row.agent_id,
      walletId: row.wallet_id,
      ownerId: row.owner_id,
      policyId: row.policy_id,
      policyVersion: numeric(row.policy_version) ?? 0,
      intentPayload: row.intent_payload,
      policyDocument: row.policy_document,
    },
    authorization:
      row.auth_envelope_id === null
        ? null
        : {
            reservationId: row.auth_reservation_id ?? "",
            envelopeId: row.auth_envelope_id,
            envelopeRevision: numeric(row.auth_envelope_revision) ?? 0,
            envelopeHash: row.auth_envelope_hash ?? "",
            expiresAt: row.auth_expires_at,
            invalidated: row.auth_invalidations !== "0",
            fences: {
              systemVersion: row.auth_system_fence_version ?? "",
              systemState: row.auth_system_state ?? "",
              ownerVersion: row.auth_owner_fence_version ?? "",
              ownerState: row.auth_owner_state ?? "",
              agentVersion: row.auth_agent_fence_version ?? "",
              agentState: row.auth_agent_state ?? "",
              policyVersion: row.auth_policy_fence_version ?? "",
              policyState: row.auth_policy_state ?? "",
            },
          },
    envelope:
      row.envelope_payload === null || row.envelope_hash === null
        ? null
        : {
            payload: row.envelope_payload,
            envelopeHash: row.envelope_hash,
            revision: numeric(row.envelope_revision) ?? 0,
          },
    latestEnvelopeRevision:
      row.latest_envelope_revision === null
        ? null
        : Number(row.latest_envelope_revision),
    reservation:
      row.reservation_status === null
        ? null
        : {
            status: row.reservation_status,
            expiresAt: row.reservation_expires_at,
          },
    fences: fences.rows.map((fence) => ({
      scope: fence.scope_type,
      state: fence.state,
      version: fence.fence_version,
    })),
    signerCredential:
      row.credential_component_id === null
        ? null
        : {
            componentId: row.credential_component_id,
            role: row.credential_role ?? "",
            status: row.credential_status ?? "",
          },
    currentFixture: fixture,
    simulations: simulationRecords,
  };
};

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

const assertCurrentSigningAuthority = async (
  client: PoolClient,
  ids: SignAuthorizedTransferIds,
  expected?: {
    reservationId: string;
    envelopeId: string;
    envelopeRevision: number;
    envelopeHash: string;
  },
): Promise<SigningAuthorityRow> => {
  const result = await client.query<SigningAuthorityRow>(
    `SELECT o.current_state AS operation_state, o.operation_id,
            o.intent_id, o.agent_id, o.wallet_id, w.owner_id,
            o.policy_id, o.policy_version,
            ae.reservation_id, ae.envelope_id, ae.envelope_revision,
            ae.envelope_hash, ae.authorization_id,
            ae.expires_at AS authorization_expires_at,
            br.status AS reservation_status,
            ai.invalidation_id,
            ae.system_fence_version::text AS system_fence_version,
            ae.system_state,
            ae.owner_fence_version::text AS owner_fence_version,
            ae.owner_state,
            ae.agent_fence_version::text AS agent_fence_version,
            ae.agent_state,
            ae.policy_fence_version::text AS policy_fence_version,
            ae.policy_state
     FROM operations o
     JOIN wallets w ON w.wallet_id = o.wallet_id
     JOIN authorization_evidence ae
       ON ae.operation_id = o.operation_id
      AND ae.authorization_id = $2
     JOIN budget_reservations br
       ON br.operation_id = o.operation_id
      AND br.reservation_id = ae.reservation_id
     JOIN execution_envelopes e
       ON e.operation_id = o.operation_id
      AND e.envelope_id = ae.envelope_id
      AND e.revision = ae.envelope_revision
      AND e.envelope_hash = ae.envelope_hash
     JOIN local_chain_fixtures f ON f.is_current
     LEFT JOIN authorization_invalidations ai
       ON ai.authorization_id = ae.authorization_id
     WHERE o.operation_id = $1
       AND ae.expires_at > now()
       AND NOT EXISTS (
         SELECT 1 FROM execution_envelopes newer
         WHERE newer.operation_id = o.operation_id
           AND newer.revision > ae.envelope_revision
       )
     FOR UPDATE OF o, ae, br`,
    [ids.operationId, ids.authorizationId],
  );
  const row = result.rows[0];
  if (
    !row ||
    !["AUTHORIZED", "SIGNING"].includes(row.operation_state) ||
    row.reservation_status !== "AUTHORIZED" ||
    row.invalidation_id !== null ||
    (expected !== undefined &&
      (row.reservation_id !== expected.reservationId ||
        row.envelope_id !== expected.envelopeId ||
        Number(row.envelope_revision) !== expected.envelopeRevision ||
        row.envelope_hash !== expected.envelopeHash))
  ) {
    throw new Error("canonical signing authority is stale or invalid");
  }

  const fences = await client.query<{
    scope_type: "SYSTEM" | "OWNER" | "AGENT" | "POLICY";
    state: string;
    fence_version: string;
  }>(
    `SELECT scope_type, state, fence_version::text AS fence_version
     FROM control_fences
     WHERE (scope_type, scope_id) IN (
       ('SYSTEM', 'system'), ('OWNER', $1), ('AGENT', $2), ('POLICY', $3)
     )
     FOR UPDATE`,
    [row.owner_id, row.agent_id, row.policy_id],
  );
  const current = new Map(
    fences.rows.map((fence) => [fence.scope_type, fence]),
  );
  const matches =
    current.size === 4 &&
    current.get("SYSTEM")?.state === "ACTIVE" &&
    current.get("OWNER")?.state === "ACTIVE" &&
    current.get("AGENT")?.state === "ACTIVE" &&
    current.get("POLICY")?.state === "ACTIVE" &&
    current.get("SYSTEM")?.fence_version === row.system_fence_version &&
    current.get("OWNER")?.fence_version === row.owner_fence_version &&
    current.get("AGENT")?.fence_version === row.agent_fence_version &&
    current.get("POLICY")?.fence_version === row.policy_fence_version;
  if (!matches) throw new Error("canonical control fence is stale or inactive");
  return row;
};

const auditCorrelation = (row: SigningAuthorityRow) => ({
  reservationId: row.reservation_id,
  ownerId: row.owner_id,
  agentId: row.agent_id,
  walletId: row.wallet_id,
  intentId: row.intent_id,
  operationId: row.operation_id,
  policyId: row.policy_id,
  policyVersion: Number(row.policy_version),
});

/** PostgreSQL-backed trusted-state store for the restricted local signer. */
export const createSignerStore = (pool: Pool): SignerStore => ({
  loadSigningContext: (ids, credentialId) =>
    withClient(pool, (client) => loadContext(client, ids, credentialId)),

  findDurableSignedEvidence: (ids) =>
    withClient(pool, async (client) => {
      const result = await client.query<{
        expected_transaction_hash: string;
        signed_at: string;
      }>(
        `SELECT expected_transaction_hash, signed_at::text AS signed_at
         FROM signed_transactions
         WHERE operation_id = $1 AND authorization_id = $2`,
        [ids.operationId, ids.authorizationId],
      );
      const row = result.rows[0];
      return row
        ? {
            transactionHash: row.expected_transaction_hash as `0x${string}`,
            signedAt: row.signed_at,
          }
        : null;
    }),

  beginSigning: (ids, audit) =>
    withClient(pool, async (client) => {
      await client.query("BEGIN");
      try {
        const authority = await assertCurrentSigningAuthority(client, ids);
        if (authority.operation_state === "AUTHORIZED") {
          const update = await client.query(
            `UPDATE operations
             SET current_state = 'SIGNING', version = version + 1, updated_at = now()
             WHERE operation_id = $1 AND current_state = 'AUTHORIZED'`,
            [ids.operationId],
          );
          if (update.rowCount !== 1)
            throw new Error("operation left AUTHORIZED concurrently");
        }
        await appendAuditEvent(client, {
          eventId: `${audit.eventIdBase}:started:${randomUUID()}`,
          actorType: "adapter",
          actorId: audit.actorId,
          traceId: audit.traceId,
          ...auditCorrelation(authority),
          eventType: "signing.started",
          data: {
            reservationId: authority.reservation_id,
            authorizationId: ids.authorizationId,
            credentialId: audit.credentialId,
            componentId: audit.actorId,
            componentRole: "ADAPTER",
            authenticationMethod: "ed25519",
            adapterId: "local-anvil",
            chainId: "eip155:31337",
          },
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }),

  persistSignedEvidence: (input, audit) =>
    withClient(pool, async (client) => {
      await client.query("BEGIN");
      try {
        const authority = await assertCurrentSigningAuthority(
          client,
          input.ids,
          {
            reservationId: input.reservationId,
            envelopeId: input.envelopeId,
            envelopeRevision: input.envelopeRevision,
            envelopeHash: input.envelopeHash,
          },
        );
        await client.query(
          `INSERT INTO signed_transactions
            (signed_transaction_id, operation_id, reservation_id, envelope_id,
             envelope_revision, envelope_hash, authorization_id, simulation_id,
             fixture_instance_id, expected_transaction_hash, signer_credential_id,
             signer_component_id, signed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz)`,
          [
            input.signedTransactionId,
            input.ids.operationId,
            input.reservationId,
            input.envelopeId,
            input.envelopeRevision,
            input.envelopeHash,
            input.ids.authorizationId,
            input.simulationId,
            input.fixtureInstanceId,
            input.expectedTransactionHash,
            input.signerCredentialId,
            audit.actorId,
            input.signedAt,
          ],
        );
        const update = await client.query(
          `UPDATE operations
           SET current_state = 'SIGNED', version = version + 1, updated_at = now()
           WHERE operation_id = $1 AND current_state IN ('AUTHORIZED', 'SIGNING')`,
          [input.ids.operationId],
        );
        if (update.rowCount !== 1)
          throw new Error("operation left the signable window");
        await appendAuditEvent(client, {
          eventId: `${audit.eventIdBase}:signed:${randomUUID()}`,
          actorType: "adapter",
          actorId: audit.actorId,
          traceId: audit.traceId,
          ...auditCorrelation(authority),
          eventType: "transaction.signed",
          data: {
            reservationId: authority.reservation_id,
            authorizationId: input.ids.authorizationId,
            envelopeId: input.envelopeId,
            envelopeRevision: input.envelopeRevision,
            envelopeHash: input.envelopeHash,
            transactionHash: input.expectedTransactionHash,
            componentId: audit.actorId,
            componentRole: "ADAPTER",
            authenticationMethod: "ed25519",
            adapterId: "local-anvil",
            chainId: "eip155:31337",
          },
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }),

  recordSigningRefusal: (operationId, reasonCode, audit) =>
    withClient(pool, async (client) => {
      const context = await client.query<SigningAuthorityRow>(
        `SELECT o.current_state AS operation_state, o.operation_id,
                o.intent_id, o.agent_id, o.wallet_id, w.owner_id,
                o.policy_id, o.policy_version, br.reservation_id,
                '' AS envelope_id, 0 AS envelope_revision, '' AS envelope_hash,
                '' AS authorization_id, now() AS authorization_expires_at,
                br.status AS reservation_status, NULL AS invalidation_id,
                '' AS system_fence_version, '' AS system_state,
                '' AS owner_fence_version, '' AS owner_state,
                '' AS agent_fence_version, '' AS agent_state,
                '' AS policy_fence_version, '' AS policy_state
         FROM operations o
         JOIN wallets w ON w.wallet_id = o.wallet_id
         JOIN budget_reservations br ON br.operation_id = o.operation_id
         WHERE o.operation_id = $1
         ORDER BY br.created_at DESC
         LIMIT 1`,
        [operationId],
      );
      const authority = context.rows[0];
      if (!authority) return;
      await appendAuditEvent(client, {
        eventId: `evt:${operationId}:signing-failed:${randomUUID()}`,
        actorType: "adapter",
        actorId: audit.actorId,
        traceId: audit.traceId,
        ...auditCorrelation(authority),
        eventType: "signing.failed",
        data: {
          reservationId: authority.reservation_id,
          reasonCode,
          credentialId: audit.credentialId,
          componentId: audit.actorId,
          componentRole: "ADAPTER",
          authenticationMethod: "ed25519",
          adapterId: "local-anvil",
          chainId: "eip155:31337",
        },
      });
    }),
});
