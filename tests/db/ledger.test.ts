import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool, type PoolClient } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  applyMigrations,
  appendAuditEvent,
  disputeReservation,
  expireReservation,
  finalizeReservation,
  getBudget,
  releaseReservation,
  reserveBudget,
  withSerializableTransaction,
  type AuditContext,
} from "@crip/budget-ledger";

const repositoryRoot = join(import.meta.dirname, "../..");
const assetAddress = "0x0000000000000000000000000000000000000001";
type Queryable = Pick<PoolClient, "query">;

const runtimePassword = (): string => {
  if (process.env.CRIP_POSTGRES_PASSWORD)
    return process.env.CRIP_POSTGRES_PASSWORD;
  const path = join(repositoryRoot, ".local/runtime.env");
  if (!existsSync(path))
    throw new Error(
      "PostgreSQL runtime is not initialized; run npm run dev:up first",
    );
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((value) => value.startsWith("CRIP_POSTGRES_PASSWORD="));
  if (!line) throw new Error("PostgreSQL runtime password is missing");
  return line.slice("CRIP_POSTGRES_PASSWORD=".length);
};

const pool = new Pool({
  host: process.env.CRIP_POSTGRES_HOST ?? "127.0.0.1",
  port: Number(process.env.CRIP_POSTGRES_PORT ?? 55432),
  database: process.env.CRIP_POSTGRES_DATABASE ?? "crip_wallet",
  user: process.env.CRIP_POSTGRES_USER ?? "crip",
  password: runtimePassword(),
  max: 8,
});

const auditContext = (operationId: string): AuditContext => ({
  eventId: `evt_${operationId}`,
  actorType: "system",
  actorId: "ledger-test",
  ownerId: "owner_1",
  agentId: "agent_1",
  walletId: "wallet_1",
  intentId: `intent_${operationId}`,
  operationId,
  policyId: "policy_1",
  policyVersion: 1,
  traceId: createHash("md5").update(operationId).digest("hex"),
});

const seedFixture = async (client: Queryable): Promise<void> => {
  await client.query(`
    INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'Ledger test owner');
    INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'Ledger test agent');
    INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'Ledger test wallet');
    INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
    INSERT INTO policy_versions (policy_id, version, document, document_hash) VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:0000000000000000000000000000000000000000000000000000000000000000');
    INSERT INTO budget_accounts (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address, allocated, available, reserved, finalized_spend)
      VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '${assetAddress}', 100, 100, 0, 0);
  `);
};

const insertOperation = async (
  client: Queryable,
  operationId: string,
): Promise<void> => {
  await client.query(
    `INSERT INTO intents (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, $3::jsonb, $4)`,
    [
      `intent_${operationId}`,
      `intent-key-${operationId}`,
      JSON.stringify({ operationId }),
      `sha256:${createHash("sha256").update(operationId).digest("hex")}`,
    ],
  );
  await client.query(
    `INSERT INTO operations (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED')`,
    [operationId, `intent_${operationId}`],
  );
};

const reset = async (): Promise<void> => {
  await pool.query(
    "TRUNCATE audit_events, idempotency_records, budget_reservations, budget_accounts, operations, intents, policy_decisions, execution_envelopes, policy_versions, policies, wallets, agents, owners CASCADE",
  );
  await withSerializableTransaction(pool, seedFixture);
};

const reserve = (
  operationId: string,
  reservationId: string,
  key: string,
  amount: string,
  expiresAt = "2099-01-01T00:00:00.000Z",
) =>
  reserveBudget(pool, {
    reservationId,
    budgetId: "budget_1",
    operationId,
    idempotencyKey: key,
    idempotencyPayload: { amount, operationId },
    amountAtomic: amount,
    expiresAt,
    audit: auditContext(operationId),
  });

describe.sequential("WS-003 PostgreSQL budget ledger", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(reset);
  afterAll(async () => pool.end());

  test("applies a forward-only migration and records its checksum", async () => {
    const migration = await pool.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
    );
    expect(migration.rows).toHaveLength(2);
    expect(migration.rows.map((row) => row.filename)).toEqual([
      "0001_ws003_budget_ledger.sql",
      "0002_ws003_idempotency_binding_guard.sql",
    ]);
    expect(
      migration.rows.every((row) => /^sha256:[0-9a-f]{64}$/.test(row.checksum)),
    ).toBe(true);
    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name",
      [
        [
          "policies",
          "intents",
          "operations",
          "execution_envelopes",
          "policy_decisions",
          "budget_accounts",
          "budget_reservations",
          "idempotency_records",
          "audit_events",
        ],
      ],
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "audit_events",
      "budget_accounts",
      "budget_reservations",
      "execution_envelopes",
      "idempotency_records",
      "intents",
      "operations",
      "policies",
      "policy_decisions",
    ]);
  });

  test("reserves available budget and audits the state change transactionally", async () => {
    await insertOperation(pool, "op_reserve");
    expect(
      (await reserve("op_reserve", "res_reserve", "reserve-key", "30")).status,
    ).toBe("HELD");
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      allocated: "100",
      available: "70",
      reserved: "30",
      finalizedSpend: "0",
    });
    expect(
      (await pool.query("SELECT event_type FROM audit_events")).rows,
    ).toEqual([{ event_type: "budget.reservation.created" }]);
  });

  test("enforces balanced numeric constraints and foreign keys", async () => {
    await expect(
      pool.query(
        "UPDATE budget_accounts SET reserved = 1 WHERE budget_id = 'budget_1'",
      ),
    ).rejects.toThrow(/budget_accounts_invariant/i);
    await expect(
      pool.query("DELETE FROM policies WHERE policy_id = 'policy_1'"),
    ).rejects.toThrow(/foreign key/i);
  });

  test("rejects insufficient available budget without a reservation or audit row", async () => {
    await insertOperation(pool, "op_insufficient");
    await expect(
      reserve("op_insufficient", "res_insufficient", "insufficient-key", "101"),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BUDGET" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM budget_reservations",
        )
      ).rows[0]?.count,
    ).toBe(0);
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM audit_events"))
        .rows[0]?.count,
    ).toBe(0);
    expect((await getBudget(pool, "budget_1")).snapshot.available).toBe("100");
  });

  test("releases and expires reservations back into available", async () => {
    await insertOperation(pool, "op_release");
    await insertOperation(pool, "op_expire");
    await reserve("op_release", "res_release", "release-key", "20");
    await releaseReservation(pool, {
      reservationId: "res_release",
      audit: auditContext("op_release"),
    });
    await releaseReservation(pool, {
      reservationId: "res_release",
      audit: auditContext("op_release"),
    });
    await reserve(
      "op_expire",
      "res_expire",
      "expire-key",
      "15",
      "2020-01-01T00:00:00.000Z",
    );
    await expireReservation(pool, {
      reservationId: "res_expire",
      now: "2021-01-01T00:00:00.000Z",
      audit: auditContext("op_expire"),
    });
    await expireReservation(pool, {
      reservationId: "res_expire",
      now: "2021-01-01T00:00:00.000Z",
      audit: auditContext("op_expire"),
    });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      allocated: "100",
      available: "100",
      reserved: "0",
      finalizedSpend: "0",
    });
  });

  test("finalizes actual spend and releases unused reservation", async () => {
    await insertOperation(pool, "op_finalize");
    await reserve("op_finalize", "res_finalize", "finalize-key", "40");
    const finalized = await finalizeReservation(pool, {
      reservationId: "res_finalize",
      actualSpendAtomic: "25",
      proofReference: "receipt:0x01",
      audit: auditContext("op_finalize"),
    });
    expect(finalized).toMatchObject({
      status: "FINALIZED",
      finalizedSpendAtomic: "25",
    });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      allocated: "100",
      available: "75",
      reserved: "0",
      finalizedSpend: "25",
    });
  });

  test("marks ambiguous state disputed without releasing reserved value", async () => {
    await insertOperation(pool, "op_dispute");
    await reserve("op_dispute", "res_dispute", "dispute-key", "35");
    expect(
      (
        await disputeReservation(pool, {
          reservationId: "res_dispute",
          reason: "broadcast outcome is ambiguous",
          audit: auditContext("op_dispute"),
        })
      ).status,
    ).toBe("DISPUTED");
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "65",
      reserved: "35",
      finalizedSpend: "0",
    });
  });

  test("retries SQLSTATE 40001 a bounded number of times", async () => {
    let attempts = 0;
    await expect(
      withSerializableTransaction(
        pool,
        async () => {
          attempts += 1;
          const error = new Error(
            "synthetic serialization failure",
          ) as Error & { code: string };
          error.code = "40001";
          throw error;
        },
        { maxRetries: 2, retryDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ code: "40001" });
    expect(attempts).toBe(3);
  });

  test("rolls back the balance when the transactional audit write fails", async () => {
    await insertOperation(pool, "op_audit_rollback");
    await expect(
      withSerializableTransaction(pool, async (client) => {
        await client.query(
          "UPDATE budget_accounts SET available = available - 10, reserved = reserved + 10 WHERE budget_id = 'budget_1'",
        );
        await appendAuditEvent(client, {
          ...auditContext("op_audit_rollback"),
          eventId: "evt_bad",
          eventType: "not-a-real-event",
          data: { amountAtomic: "10" },
        } as never);
      }),
    ).rejects.toThrow();
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "100",
      reserved: "0",
    });
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM audit_events"))
        .rows[0]?.count,
    ).toBe(0);
  });

  test("returns the original state for an idempotent retry and rejects payload conflict", async () => {
    await insertOperation(pool, "op_idempotent");
    const first = await reserve(
      "op_idempotent",
      "res_idempotent",
      "same-key",
      "20",
    );
    const retry = await reserveBudget(pool, {
      reservationId: "different-id",
      budgetId: "budget_1",
      operationId: "op_idempotent",
      idempotencyKey: "same-key",
      idempotencyPayload: { amount: "20", operationId: "op_idempotent" },
      amountAtomic: "20",
      expiresAt: "2099-01-01T00:00:00.000Z",
      audit: auditContext("op_idempotent"),
    });
    expect(retry).toEqual(first);
    await expect(
      reserveBudget(pool, {
        reservationId: "other",
        budgetId: "budget_1",
        operationId: "op_idempotent",
        idempotencyKey: "same-key",
        idempotencyPayload: { amount: "21", operationId: "op_idempotent" },
        amountAtomic: "21",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: auditContext("op_idempotent"),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await getBudget(pool, "budget_1")).snapshot.reserved).toBe("20");
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM audit_events"))
        .rows[0]?.count,
    ).toBe(1);
  });

  test("enforces immutable policy versions and append-only audit rows", async () => {
    await insertOperation(pool, "op_immutable");
    await expect(
      pool.query(
        "UPDATE policy_versions SET document = '{\"changed\":true}' WHERE policy_id = 'policy_1' AND version = 1",
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      pool.query(
        "DELETE FROM policy_versions WHERE policy_id = 'policy_1' AND version = 1",
      ),
    ).rejects.toThrow(/immutable/i);
    await reserve("op_immutable", "res_immutable", "immutable-key", "10");
    await expect(pool.query("DELETE FROM audit_events")).rejects.toThrow(
      /immutable/i,
    );
    await expect(
      pool.query(
        "UPDATE idempotency_records SET payload_hash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'",
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(pool.query("DELETE FROM idempotency_records")).rejects.toThrow(
      /immutable/i,
    );
  });
});
