import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { appendAuditEvent, type AuditEventInput } from "../src/index.js";

describe("audit append deadline hook", () => {
  it("refreshes a caller deadline after the lock read and before insert", async () => {
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(
          sql.includes("INSERT INTO audit_events") ? "insert" : "select",
        );
        return { rows: [], rowCount: 0 };
      },
    } as unknown as PoolClient;
    const input: AuditEventInput = {
      eventId: "evt:op_1:signed",
      actorType: "adapter",
      actorId: "adapter_1",
      traceId: "0123456789abcdef0123456789abcdef",
      reservationId: "res_1",
      ownerId: "owner_1",
      agentId: "agent_1",
      walletId: "wallet_1",
      intentId: "intent_1",
      operationId: "op_1",
      policyId: "policy_1",
      policyVersion: 1,
      eventType: "transaction.signed",
      data: {
        transactionHash: `0x${"a".repeat(64)}`,
        chainId: "eip155:31337",
      },
    };

    await appendAuditEvent(client, input, async () => {
      calls.push("refresh-deadline");
    });

    expect(calls).toEqual(["select", "refresh-deadline", "insert"]);
  });
});
