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
