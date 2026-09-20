import type { Pool, PoolClient } from "pg";
import type {
  BroadcastAttempt,
  BroadcastStore,
  DurableSignedTransaction,
} from "./broadcast-core.js";

type AttemptRow = Record<string, string | number | null> & {
  status: BroadcastAttempt["status"];
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

  startBroadcastAttempt: (signed, attemptId) =>
    withClient(pool, async (client) => {
      await client.query("BEGIN");
      try {
        const authority = await client.query<{
          operation_id: string;
          reservation_id: string;
          authorization_id: string;
          owner_id: string;
          agent_id: string;
          policy_id: string;
        }>(
          `SELECT s.operation_id, s.reservation_id, s.authorization_id,
                  w.owner_id, o.agent_id, o.policy_id
           FROM signed_transactions s
           JOIN operations o ON o.operation_id = s.operation_id
           JOIN wallets w ON w.wallet_id = o.wallet_id
           WHERE s.signed_transaction_id = $1`,
          [signed.signedTransactionId],
        );
        const binding = authority.rows[0];
        if (
          !binding ||
          binding.operation_id !== signed.operationId ||
          binding.reservation_id !== signed.reservationId ||
          binding.authorization_id !== signed.authorizationId
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

        const reservation = await client.query<{ status: string }>(
          `SELECT status FROM budget_reservations
           WHERE reservation_id = $1 FOR UPDATE`,
          [signed.reservationId],
        );
        if (reservation.rows[0]?.status !== "AUTHORIZED")
          throw new Error(
            "broadcast attempt requires an execution-valid AUTHORIZED reservation",
          );
        await barriers.afterReservationLocked?.();
        const existing = await client.query<AttemptRow>(
          `SELECT ${attemptColumns} FROM broadcast_attempts
         WHERE attempt_id = $1 OR signed_transaction_id = $2
         ORDER BY created_at ASC LIMIT 1`,
          [attemptId, signed.signedTransactionId],
        );
        if (existing.rows[0]) {
          await client.query("COMMIT");
          return attemptFromRow(existing.rows[0]);
        }
        const invalidation = await client.query(
          `SELECT 1 FROM authorization_invalidations
           WHERE authorization_id = $1`,
          [signed.authorizationId],
        );
        if (invalidation.rowCount !== 0)
          throw new Error(
            "broadcast attempt cannot start after authorization invalidation",
          );

        // Make STARTED and control's locked reservation row conflict so a
        // serializable control snapshot taken before this commit must retry.
        const touched = await client.query(
          `UPDATE budget_reservations SET updated_at = now()
           WHERE reservation_id = $1 AND status = 'AUTHORIZED'
           RETURNING reservation_id`,
          [signed.reservationId],
        );
        if (touched.rowCount !== 1)
          throw new Error("broadcast attempt lost its authorized reservation");
        await client.query(
          `INSERT INTO broadcast_attempts
          (attempt_id, signed_transaction_id, operation_id, reservation_id, envelope_id,
           envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
           expected_transaction_hash)
         SELECT $1, signed_transaction_id, operation_id, reservation_id, envelope_id,
                envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
                expected_transaction_hash FROM signed_transactions WHERE signed_transaction_id = $2
         ON CONFLICT DO NOTHING`,
          [attemptId, signed.signedTransactionId],
        );
        const inserted = await client.query<AttemptRow>(
          `SELECT ${attemptColumns} FROM broadcast_attempts
         WHERE attempt_id = $1 OR signed_transaction_id = $2
         ORDER BY created_at ASC LIMIT 1`,
          [attemptId, signed.signedTransactionId],
        );
        if (!inserted.rows[0])
          throw new Error("broadcast attempt was not persisted");
        await client.query("COMMIT");
        return attemptFromRow(inserted.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }),

  finishBroadcastAttempt: (input) =>
    withClient(pool, async (client) => {
      const result = await client.query<AttemptRow>(
        `UPDATE broadcast_attempts SET status = $2, response_transaction_hash = $3,
         classification_reason = $4, completed_at = now() WHERE attempt_id = $1
       RETURNING ${attemptColumns}`,
        [
          input.attemptId,
          input.status,
          input.responseTransactionHash,
          input.classificationReason,
        ],
      );
      if (!result.rows[0]) throw new Error("broadcast attempt not found");
      return attemptFromRow(result.rows[0]);
    }),
});
