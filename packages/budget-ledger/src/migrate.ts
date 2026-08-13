import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = [
  join(moduleDirectory, "../../migrations"),
  join(moduleDirectory, "../../../../migrations"),
].find((directory) => existsSync(directory));

if (!migrationDirectory)
  throw new Error("forward migration directory is missing");

const migrationFiles = (): string[] =>
  readdirSync(migrationDirectory)
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file))
    .sort((left, right) => {
      const leftNumber = Number(left.split("_", 1)[0]);
      const rightNumber = Number(right.split("_", 1)[0]);
      return leftNumber - rightNumber || left.localeCompare(right);
    });

const checksum = (sql: string): string =>
  `sha256:${createHash("sha256").update(sql, "utf8").digest("hex")}`;

/** Apply ordered SQL migrations; there is intentionally no down-migration API. */
export const applyMigrations = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  let migrationLockAcquired = false;
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('crip-wallet-forward-migrations'))",
    );
    migrationLockAcquired = true;
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("COMMIT");

    for (const filename of migrationFiles()) {
      const sql = readFileSync(join(migrationDirectory, filename), "utf8");
      const expectedChecksum = checksum(sql);
      await client.query("BEGIN");
      const applied = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE filename = $1",
        [filename],
      );
      if (applied.rowCount) {
        if (applied.rows[0]?.checksum !== expectedChecksum)
          throw new Error(`migration checksum mismatch: ${filename}`);
        await client.query("COMMIT");
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [filename, expectedChecksum],
      );
      await client.query("COMMIT");
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* preserve migration error */
    }
    throw error;
  } finally {
    if (migrationLockAcquired) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('crip-wallet-forward-migrations'))",
        );
      } catch {
        // Preserve the migration result; the client is released immediately.
      }
    }
    client.release();
  }
};
