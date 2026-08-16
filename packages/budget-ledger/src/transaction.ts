import type { Pool, PoolClient } from "pg";

export type TransactionWork<T> = (client: PoolClient) => Promise<T>;

export interface SerializableTransactionOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

export const isSerializationFailure = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "40001";

const delay = async (milliseconds: number): Promise<void> => {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) =>
    globalThis.setTimeout(resolve, milliseconds),
  );
};

/** Run one complete serializable transaction on one checked-out node-postgres client. */
export const withSerializableTransaction = async <T>(
  pool: Pool,
  work: TransactionWork<T>,
  options: SerializableTransactionOptions = {},
): Promise<T> => {
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 5;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 8) {
    throw new RangeError("maxRetries must be an integer between 0 and 8");
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      if (!isSerializationFailure(error) || attempt === maxRetries) throw error;
      await delay(retryDelayMs * (attempt + 1));
    } finally {
      client.release();
    }
  }
  throw new Error("unreachable serializable transaction retry state");
};
