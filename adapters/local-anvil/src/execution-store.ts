import type { Pool, PoolClient } from "pg";

import type {
  BroadcastAttempt,
  BroadcastAttemptStatus,
} from "./broadcast-core.js";
import type { ExecutionSerializationStore } from "./execution-core.js";

type AttemptRow = {
  attempt_id: string;
  signed_transaction_id: string;
  operation_id: string;
  reservation_id: string;
  envelope_id: string;
  envelope_revision: number | string;
  envelope_hash: string;
  authorization_id: string;
  fixture_instance_id: string;
  expected_transaction_hash: string;
  status: BroadcastAttemptStatus;
  response_transaction_hash: string | null;
  classification_reason: string | null;
};

const attemptFromRow = (row: AttemptRow): BroadcastAttempt => ({
  attemptId: row.attempt_id,
  signedTransactionId: row.signed_transaction_id,
  operationId: row.operation_id,
  reservationId: row.reservation_id,
  envelopeId: row.envelope_id,
  envelopeRevision: Number(row.envelope_revision),
  envelopeHash: row.envelope_hash,
  authorizationId: row.authorization_id,
  fixtureInstanceId: row.fixture_instance_id,
  expectedTransactionHash: row.expected_transaction_hash,
  status: row.status,
  responseTransactionHash: row.response_transaction_hash,
  classificationReason: row.classification_reason,
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

const attemptColumns = `attempt_id, signed_transaction_id, operation_id,
  reservation_id, envelope_id, envelope_revision, envelope_hash,
  authorization_id, fixture_instance_id, expected_transaction_hash, status,
  response_transaction_hash, classification_reason`;

/** PostgreSQL serialization and lifecycle lookup for the restricted child. */
export const createExecutionSerializationStore = (
  pool: Pool,
): ExecutionSerializationStore => ({
  withExecutionLock: async (operationId, work) => {
    const client = await pool.connect();
    const lockKey = `crip/local-anvil/execution:${operationId}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        lockKey,
      ]);
      return await work();
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey])
        .catch(() => undefined);
      client.release();
    }
  },

  findBroadcastAttempt: (ids) =>
    withClient(pool, async (client) => {
      const result = await client.query<AttemptRow>(
        `SELECT ${attemptColumns}
         FROM broadcast_attempts
         WHERE operation_id = $1 AND authorization_id = $2
         ORDER BY created_at ASC LIMIT 1`,
        [ids.operationId, ids.authorizationId],
      );
      return result.rows[0] ? attemptFromRow(result.rows[0]) : null;
    }),
});
