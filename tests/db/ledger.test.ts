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
  authorizeReservation,
  disputeReservation,
  expireReservation,
  finalizeReservation,
  getBudget,
  markReservationBroadcast,
  releaseReservation,
  reserveBudget,
  verifyAuditEvent,
  verifyBroadcastEvidence,
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

const adapterAuditContext = (operationId: string): AuditContext => ({
  ...auditContext(operationId),
  actorType: "adapter",
  actorId: "adapter-test",
});

const reconcilerAuditContext = (operationId: string): AuditContext => ({
  ...auditContext(operationId),
  actorType: "worker",
  actorId: "reconciler:ledger-test",
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
    expect(migration.rows).toHaveLength(12);
    expect(migration.rows.map((row) => row.filename)).toEqual([
      "0001_ws003_budget_ledger.sql",
      "0002_ws003_idempotency_binding_guard.sql",
      "0003_ws003_reservation_broadcast_audit.sql",
      "0004_ws003_evidence_and_binding_guards.sql",
      "0005_ws003_audit_hash_guard.sql",
      "0006_ws003_audit_hash_domain_fix.sql",
      "0007_ws003_evidence_verification.sql",
      "0008_ws003_audit_row_binding_guard.sql",
      "0009_ws003_audit_legacy_fail_closed.sql",
      "0010_ws003_parent_binding_guards.sql",
      "0011_ws003_pending_evidence_default_fix.sql",
      "0012_ws003_evidence_guard_column_fix.sql",
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

  test("is idempotent on upgrade and fails closed on migration checksum drift", async () => {
    const before = await pool.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
    );
    await expect(applyMigrations(pool)).resolves.toBeUndefined();
    expect(
      (
        await pool.query<{ filename: string; checksum: string }>(
          "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
        )
      ).rows,
    ).toEqual(before.rows);

    const target = before.rows.at(-1)!;
    const driftedChecksum = `sha256:${"f".repeat(64)}`;
    await pool.query(
      "UPDATE schema_migrations SET checksum = $1 WHERE filename = $2",
      [driftedChecksum, target.filename],
    );
    await expect(applyMigrations(pool)).rejects.toThrow(
      `migration checksum mismatch: ${target.filename}`,
    );
    await pool.query(
      "UPDATE schema_migrations SET checksum = $1 WHERE filename = $2",
      [target.checksum, target.filename],
    );
    await expect(applyMigrations(pool)).resolves.toBeUndefined();
  });

  test("fails closed before upgrading a legacy audit row without a v1 payload", async () => {
    await insertOperation(pool, "op_legacy_audit");
    await reserve(
      "op_legacy_audit",
      "res_legacy_audit",
      "legacy-audit-key",
      "10",
    );
    const migration = await pool.query<{
      checksum: string;
      applied_at: Date;
    }>(
      "SELECT checksum, applied_at FROM schema_migrations WHERE filename = '0009_ws003_audit_legacy_fail_closed.sql'",
    );
    const event = await pool.query<{
      event_id: string;
      canonical_payload: string;
    }>(
      "SELECT event_id, canonical_payload FROM audit_events WHERE operation_id = $1",
      ["op_legacy_audit"],
    );
    const original = event.rows[0]!;
    await pool.query(
      "DROP TRIGGER audit_events_are_append_only ON audit_events",
    );
    await pool.query(
      "ALTER TABLE audit_events ALTER COLUMN canonical_payload DROP NOT NULL",
    );
    await pool.query(
      "UPDATE audit_events SET canonical_payload = NULL WHERE event_id = $1",
      [original.event_id],
    );
    await pool.query(
      "DELETE FROM schema_migrations WHERE filename = '0009_ws003_audit_legacy_fail_closed.sql'",
    );
    try {
      await expect(applyMigrations(pool)).rejects.toThrow(/legacy audit rows/i);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM schema_migrations WHERE filename = '0009_ws003_audit_legacy_fail_closed.sql'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await pool.query(
        "UPDATE audit_events SET canonical_payload = $1 WHERE event_id = $2",
        [original.canonical_payload, original.event_id],
      );
      await pool.query(
        "ALTER TABLE audit_events ALTER COLUMN canonical_payload SET NOT NULL",
      );
      await pool.query(
        `CREATE TRIGGER audit_events_are_append_only
         BEFORE UPDATE OR DELETE ON audit_events
         FOR EACH ROW EXECUTE FUNCTION reject_immutable_record()`,
      );
      await pool.query(
        "INSERT INTO schema_migrations (filename, checksum, applied_at) VALUES ($1, $2, $3)",
        [
          "0009_ws003_audit_legacy_fail_closed.sql",
          migration.rows[0]!.checksum,
          migration.rows[0]!.applied_at,
        ],
      );
      await expect(applyMigrations(pool)).resolves.toBeUndefined();
    }
  });

  test("serializes concurrent migration runners and rolls back failed DDL", async () => {
    await expect(
      Promise.all([applyMigrations(pool), applyMigrations(pool)]),
    ).resolves.toEqual([undefined, undefined]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TABLE migration_recovery_probe (id integer PRIMARY KEY)",
      );
      await expect(client.query("SELECT 1 / 0")).rejects.toThrow();
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(
      (
        await pool.query(
          "SELECT to_regclass('public.migration_recovery_probe') AS table_name",
        )
      ).rows[0]?.table_name,
    ).toBeNull();
    await expect(applyMigrations(pool)).resolves.toBeUndefined();
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
    await authorizeReservation(pool, {
      reservationId: "res_finalize",
      audit: auditContext("op_finalize"),
    });
    await markReservationBroadcast(pool, {
      reservationId: "res_finalize",
      audit: adapterAuditContext("op_finalize"),
      evidence: {
        transactionHash: `0x${"1".repeat(64)}`,
        nonce: "1",
        receiptReference: "receipt:op_finalize",
      },
    });
    await verifyBroadcastEvidence(pool, {
      reservationId: "res_finalize",
      audit: reconcilerAuditContext("op_finalize"),
    });
    const finalized = await finalizeReservation(pool, {
      reservationId: "res_finalize",
      actualSpendAtomic: "25",
      proofReference: "receipt:op_finalize",
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

  test("rejects broadcast and finalization without adapter evidence", async () => {
    await insertOperation(pool, "op_forged_broadcast");
    await reserve(
      "op_forged_broadcast",
      "res_forged_broadcast",
      "forged-broadcast-key",
      "40",
    );
    await authorizeReservation(pool, {
      reservationId: "res_forged_broadcast",
      audit: auditContext("op_forged_broadcast"),
    });
    await expect(
      markReservationBroadcast(pool, {
        reservationId: "res_forged_broadcast",
        audit: auditContext("op_forged_broadcast"),
        evidence: {
          transactionHash: `0x${"3".repeat(64)}`,
          nonce: "3",
          receiptReference: "receipt:forged",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_BROADCAST_EVIDENCE" });
    await expect(
      pool.query(
        "UPDATE budget_reservations SET status = 'BROADCAST' WHERE reservation_id = $1",
        ["res_forged_broadcast"],
      ),
    ).rejects.toThrow(/broadcast evidence required/i);
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "60",
      reserved: "40",
      finalizedSpend: "0",
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

  test("does not finalize a disputed reservation without a verified resolution", async () => {
    await insertOperation(pool, "op_disputed_release");
    await reserve(
      "op_disputed_release",
      "res_disputed_release",
      "disputed-release-key",
      "35",
    );
    await disputeReservation(pool, {
      reservationId: "res_disputed_release",
      reason: "broadcast outcome is ambiguous",
      audit: auditContext("op_disputed_release"),
    });

    await expect(
      finalizeReservation(pool, {
        reservationId: "res_disputed_release",
        actualSpendAtomic: "0",
        proofReference: "unverified-reference",
        audit: auditContext("op_disputed_release"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESERVATION_TRANSITION" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "65",
      reserved: "35",
      finalizedSpend: "0",
    });
  });

  test("records authorization and broadcast reservation transitions before finalization", async () => {
    await insertOperation(pool, "op_lifecycle");
    await reserve("op_lifecycle", "res_lifecycle", "lifecycle-key", "40");
    expect(
      (
        await authorizeReservation(pool, {
          reservationId: "res_lifecycle",
          audit: auditContext("op_lifecycle"),
        })
      ).status,
    ).toBe("AUTHORIZED");
    expect(
      (
        await markReservationBroadcast(pool, {
          reservationId: "res_lifecycle",
          audit: adapterAuditContext("op_lifecycle"),
          evidence: {
            transactionHash: `0x${"2".repeat(64)}`,
            nonce: "2",
            receiptReference: "receipt:op_lifecycle",
          },
        })
      ).status,
    ).toBe("BROADCAST");
    await expect(
      finalizeReservation(pool, {
        reservationId: "res_lifecycle",
        actualSpendAtomic: "25",
        proofReference: "receipt:op_lifecycle",
        audit: auditContext("op_lifecycle"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_BROADCAST_EVIDENCE" });
    await verifyBroadcastEvidence(pool, {
      reservationId: "res_lifecycle",
      audit: reconcilerAuditContext("op_lifecycle"),
    });
    await expect(
      pool.query(
        "UPDATE reservation_broadcast_evidence SET transaction_hash = $1 WHERE reservation_id = $2",
        [`0x${"f".repeat(64)}`, "res_lifecycle"],
      ),
    ).rejects.toThrow(/immutable record/i);
    expect(
      (
        await finalizeReservation(pool, {
          reservationId: "res_lifecycle",
          actualSpendAtomic: "25",
          proofReference: "receipt:op_lifecycle",
          audit: auditContext("op_lifecycle"),
        })
      ).status,
    ).toBe("FINALIZED");
    expect(
      (
        await pool.query(
          "SELECT event_type FROM audit_events WHERE operation_id = $1 ORDER BY sequence_no",
          ["op_lifecycle"],
        )
      ).rows.map((row) => row.event_type),
    ).toEqual([
      "budget.reservation.created",
      "budget.reservation.authorized",
      "budget.reservation.broadcast",
      "budget.reservation.evidence.verified",
      "budget.reservation.finalized",
    ]);
  });

  test("verifies the persisted audit timestamp, correlation, hash, and chain link", async () => {
    await insertOperation(pool, "op_audit_verify");
    await reserve(
      "op_audit_verify",
      "res_audit_verify",
      "audit-verify-key",
      "10",
    );
    const rows = await pool.query<{
      event_id: string;
      event_type: string;
      occurred_at: Date;
      sequence_no: string;
      actor_type: string;
      actor_id: string;
      owner_id: string;
      agent_id: string;
      wallet_id: string;
      intent_id: string;
      operation_id: string;
      policy_id: string;
      policy_version: number;
      trace_id: string;
      data: Record<string, unknown>;
      previous_event_hash: string | null;
      event_hash: string;
    }>(
      "SELECT * FROM audit_events WHERE operation_id = $1 ORDER BY sequence_no",
      ["op_audit_verify"],
    );
    const row = rows.rows[0]!;
    const verified = verifyAuditEvent({
      eventId: row.event_id,
      eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
      sequence: Number(row.sequence_no),
      actorType: row.actor_type,
      actorId: row.actor_id,
      ownerId: row.owner_id,
      agentId: row.agent_id,
      walletId: row.wallet_id,
      intentId: row.intent_id,
      operationId: row.operation_id,
      policyId: row.policy_id,
      policyVersion: row.policy_version,
      traceId: row.trace_id,
      data: row.data,
      previousEventHash: row.previous_event_hash,
      eventHash: row.event_hash,
    });
    expect(verified.eventHash).toBe(row.event_hash);
    expect(() => verifyAuditEvent({ ...verified, traceId: "bad" })).toThrow();
    expect(() =>
      verifyAuditEvent({
        ...verified,
        eventHash: `0x${"f".repeat(64)}`,
      }),
    ).toThrow(/hash mismatch/);
    await expect(
      pool.query(
        `INSERT INTO audit_events
          (event_id, event_type, sequence_no, actor_type, actor_id, owner_id, agent_id, wallet_id,
           intent_id, operation_id, policy_id, policy_version, trace_id, data, previous_event_hash,
           event_hash, occurred_at, canonical_payload)
         VALUES ('evt_tampered', 'budget.reservation.created', 99, 'system', 'ledger-test',
           'owner_1', 'agent_1', 'wallet_1', 'intent_op_audit_verify', 'op_audit_verify',
           'policy_1', 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}'::jsonb, NULL,
           $1, '2026-08-13T00:00:00Z', '{}')`,
        [`0x${"0".repeat(64)}`],
      ),
    ).rejects.toThrow(/canonical audit payload|hash does not match/i);
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

  test("rejects untyped audit payloads and rolls back the state change", async () => {
    await insertOperation(pool, "op_audit_contract");
    await expect(
      withSerializableTransaction(pool, async (client) => {
        await client.query(
          "UPDATE budget_accounts SET available = available - 10, reserved = reserved + 10 WHERE budget_id = 'budget_1'",
        );
        await appendAuditEvent(client, {
          ...auditContext("op_audit_contract"),
          eventId: "evt_audit_contract",
          eventType: "budget.reservation.created",
          data: { privateKey: "must-not-persist" },
        } as never);
      }),
    ).rejects.toThrow();
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "100",
      reserved: "0",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_audit_contract"],
        )
      ).rows[0]?.count,
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

  test("rejects a same-payload retry whose bound request fields changed", async () => {
    await insertOperation(pool, "op_idempotency_binding");
    await reserveBudget(pool, {
      reservationId: "res_idempotency_binding",
      budgetId: "budget_1",
      operationId: "op_idempotency_binding",
      idempotencyKey: "bound-key",
      idempotencyPayload: { invoice: "same" },
      amountAtomic: "20",
      expiresAt: "2099-01-01T00:00:00.000Z",
      audit: auditContext("op_idempotency_binding"),
    });

    await expect(
      reserveBudget(pool, {
        reservationId: "different-reservation",
        budgetId: "budget_1",
        operationId: "op_idempotency_binding",
        idempotencyKey: "bound-key",
        idempotencyPayload: { invoice: "same" },
        amountAtomic: "21",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: auditContext("op_idempotency_binding"),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "80",
      reserved: "20",
    });
  });

  test("rejects a reservation whose operation and budget bindings differ", async () => {
    await insertOperation(pool, "op_binding_mismatch");
    await pool.query(
      "INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ('policy_2', 'owner_1', 'agent_1', 'wallet_1', 'active')",
    );
    await pool.query(
      "INSERT INTO policy_versions (policy_id, version, document, document_hash) VALUES ('policy_2', 1, '{\"schemaVersion\":\"1.0\"}', $1)",
      [`sha256:${"2".repeat(64)}`],
    );
    await pool.query(
      `INSERT INTO budget_accounts
       (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address,
        allocated, available, reserved, finalized_spend)
       VALUES ('budget_2', 'agent_1', 'wallet_1', 'policy_2', 1,
        '${assetAddress}', 100, 100, 0, 0)`,
    );
    await expect(
      reserveBudget(pool, {
        reservationId: "res_binding_mismatch",
        budgetId: "budget_2",
        operationId: "op_binding_mismatch",
        idempotencyKey: "binding-mismatch-key",
        idempotencyPayload: { invoice: "binding" },
        amountAtomic: "10",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: auditContext("op_binding_mismatch"),
      }),
    ).rejects.toMatchObject({ code: "BUDGET_BINDING_MISMATCH" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "100",
      reserved: "0",
    });
    await expect(
      pool.query(
        "UPDATE budget_accounts SET policy_id = 'policy_2' WHERE budget_id = 'budget_1'",
      ),
    ).rejects.toThrow(/immutable budget binding/i);
  });

  test("coalesces concurrent worker retries into one reservation and audit event", async () => {
    await insertOperation(pool, "op_worker_retry");
    const requests = Array.from({ length: 8 }, (_, index) =>
      reserveBudget(pool, {
        reservationId: `retry-reservation-${index}`,
        budgetId: "budget_1",
        operationId: "op_worker_retry",
        idempotencyKey: "worker-retry-key",
        idempotencyPayload: { invoice: "same", amount: "20" },
        amountAtomic: "20",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: auditContext("op_worker_retry"),
      }),
    );
    const results = await Promise.all(requests);
    const reservationIds = new Set(
      results.map((result) => result.reservationId),
    );
    expect(reservationIds.size).toBe(1);
    expect([...reservationIds][0]).toMatch(/^retry-reservation-[0-7]$/);
    expect((await getBudget(pool, "budget_1")).snapshot.reserved).toBe("20");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM budget_reservations WHERE idempotency_key = $1",
          ["worker-retry-key"],
        )
      ).rows[0]?.count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_worker_retry"],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  test("replays the original reservation after a simulated lost worker response", async () => {
    await insertOperation(pool, "op_response_loss");
    const request = {
      reservationId: "response-loss-original",
      budgetId: "budget_1",
      operationId: "op_response_loss",
      idempotencyKey: "response-loss-key",
      idempotencyPayload: { invoice: "response-loss", amount: "20" },
      amountAtomic: "20",
      expiresAt: "2099-01-01T00:00:00.000Z",
      audit: auditContext("op_response_loss"),
    } as const;
    await expect(
      (async () => {
        await reserveBudget(pool, request);
        throw new Error("worker response lost after commit");
      })(),
    ).rejects.toThrow("worker response lost after commit");
    const retry = await reserveBudget(pool, {
      ...request,
      reservationId: "response-loss-retry",
    });
    expect(retry.reservationId).toBe("response-loss-original");
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "80",
      reserved: "20",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_response_loss"],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  test("retries a mutated serializable transaction without duplicating its audit event", async () => {
    await insertOperation(pool, "op_serializable_retry");
    let attempts = 0;
    await withSerializableTransaction(pool, async (client) => {
      attempts += 1;
      await client.query(
        "UPDATE budget_accounts SET available = available - 10, reserved = reserved + 10 WHERE budget_id = 'budget_1'",
      );
      await appendAuditEvent(client, {
        ...auditContext("op_serializable_retry"),
        eventId: "evt_serializable_retry",
        eventType: "budget.reservation.created",
        data: { amountAtomic: "10" },
      });
      if (attempts === 1) {
        const error = new Error("synthetic serialization failure") as Error & {
          code: string;
        };
        error.code = "40001";
        throw error;
      }
    });
    expect(attempts).toBe(2);
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "90",
      reserved: "10",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_serializable_retry"],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  test("retries a real PostgreSQL serialization failure without duplicating audit", async () => {
    await insertOperation(pool, "op_real_serialization_1");
    await insertOperation(pool, "op_real_serialization_2");
    let firstPasses = 0;
    let ready = 0;
    let release!: () => void;
    const start = new Promise<void>((resolve) => {
      release = resolve;
    });
    let allReady!: () => void;
    const readyBarrier = new Promise<void>((resolve) => {
      allReady = resolve;
    });
    const run = (operationId: string) =>
      withSerializableTransaction(pool, async (client) => {
        const firstPass = firstPasses < 2;
        firstPasses += 1;
        await client.query(
          "SELECT available FROM budget_accounts WHERE budget_id = 'budget_1'",
        );
        if (firstPass) {
          ready += 1;
          if (ready === 2) allReady();
          await start;
        }
        await client.query(
          "UPDATE budget_accounts SET available = available - 10, reserved = reserved + 10 WHERE budget_id = 'budget_1'",
        );
        await appendAuditEvent(client, {
          ...auditContext(operationId),
          eventId: `evt_${operationId}`,
          eventType: "budget.reservation.created",
          data: { amountAtomic: "10" },
        });
      });
    const requests = [
      run("op_real_serialization_1"),
      run("op_real_serialization_2"),
    ];
    await readyBarrier;
    release();
    await Promise.all(requests);
    expect(firstPasses).toBe(3);
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "80",
      reserved: "20",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE event_type = 'budget.reservation.created'",
        )
      ).rows[0]?.count,
    ).toBe(2);
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
