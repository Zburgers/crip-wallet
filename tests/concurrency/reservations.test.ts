import { join } from "node:path";

import { Pool } from "pg";
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
  getBudget,
  reserveBudget,
  withSerializableTransaction,
  type AuditContext,
} from "@crip/budget-ledger";
import { loadLocalRuntime } from "../../tooling/local-runtime.mjs";

const root = join(import.meta.dirname, "../..");
const runtime = loadLocalRuntime({ root });

const pool = new Pool({
  host: runtime.postgres.host,
  port: runtime.postgres.port,
  database: runtime.postgres.database,
  user: runtime.postgres.user,
  password: runtime.postgres.password,
  max: 8,
});

const audit = (index: number): AuditContext => ({
  eventId: `evt_${index}`,
  actorType: "system",
  actorId: "concurrency-test",
  traceId: String(index).padStart(32, "0"),
});

const setup = async (): Promise<void> => {
  await pool.query(
    "TRUNCATE audit_events, idempotency_records, budget_reservations, budget_accounts, operations, intents, policy_decisions, execution_envelopes, policy_versions, policies, wallets, agents, owners CASCADE",
  );
  await withSerializableTransaction(pool, async (client) => {
    await client.query(`
      INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'Concurrent owner');
      INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'Concurrent agent');
      INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'Concurrent wallet');
      INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
      INSERT INTO policy_versions (policy_id, version, document, document_hash) VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:0000000000000000000000000000000000000000000000000000000000000000');
      INSERT INTO budget_accounts (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address, allocated, available, reserved, finalized_spend)
        VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '0x0000000000000000000000000000000000000001', 100, 100, 0, 0);
    `);
    for (let index = 0; index < 4; index += 1) {
      await client.query(
        `INSERT INTO intents (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash) VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, $3::jsonb, $4)`,
        [
          `intent_op_${index}`,
          `intent-key-${index}`,
          JSON.stringify({ index }),
          `sha256:${String(index).padStart(64, "0")}`,
        ],
      );
      await client.query(
        `INSERT INTO operations (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state) VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED')`,
        [`op_${index}`, `intent_op_${index}`],
      );
    }
  });
};

describe.sequential("WS-003 concurrent reservations", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(setup);
  afterAll(async () => pool.end());

  test("four simultaneous reservations cannot oversubscribe 100 available units", async () => {
    for (let round = 0; round < 32; round += 1) {
      await setup();
      let ready = 0;
      let release!: () => void;
      const start = new Promise<void>((resolve) => {
        release = resolve;
      });
      let allReady!: () => void;
      const readyBarrier = new Promise<void>((resolve) => {
        allReady = resolve;
      });
      const requests = Array.from({ length: 4 }, (_, index) =>
        (async () => {
          ready += 1;
          if (ready === 4) allReady();
          await start;
          return reserveBudget(pool, {
            reservationId: `res_${index}`,
            budgetId: "budget_1",
            operationId: `op_${index}`,
            idempotencyKey: `reserve-key-${index}`,
            idempotencyPayload: { amount: "30", index },
            amountAtomic: "30",
            expiresAt: "2099-01-01T00:00:00.000Z",
            audit: audit(index),
          });
        })(),
      );
      await readyBarrier;
      release();
      const settled = await Promise.allSettled(requests);
      expect(
        settled.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(3);
      const failures = settled.filter((result) => result.status === "rejected");
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        reason: { code: "INSUFFICIENT_BUDGET" },
      });
      expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
        allocated: "100",
        available: "10",
        reserved: "90",
        finalizedSpend: "0",
      });
      expect(
        (await pool.query("SELECT count(*)::int AS count FROM audit_events"))
          .rows[0]?.count,
      ).toBe(3);
    }
  }, 30000);
});
