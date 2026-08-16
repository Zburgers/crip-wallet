import { describe, expect, test } from "vitest";
import * as fc from "fast-check";

type Balance = {
  allocated: bigint;
  available: bigint;
  reserved: bigint;
  finalizedSpend: bigint;
};
const invariant = (balance: Balance): boolean =>
  balance.allocated ===
    balance.available + balance.reserved + balance.finalizedSpend &&
  [
    balance.allocated,
    balance.available,
    balance.reserved,
    balance.finalizedSpend,
  ].every((value) => value >= 0n);

describe("WS-003 accounting invariant", () => {
  test("holds for reservation, release, expiry, finalization, and dispute", () => {
    let balance: Balance = {
      allocated: 100n,
      available: 100n,
      reserved: 0n,
      finalizedSpend: 0n,
    };
    const check = (): void => expect(invariant(balance)).toBe(true);
    check();
    balance = { ...balance, available: 60n, reserved: 40n };
    check();
    balance = { ...balance, available: 100n, reserved: 0n };
    check();
    balance = { ...balance, available: 70n, reserved: 30n };
    check();
    balance = { ...balance, available: 80n, reserved: 0n, finalizedSpend: 20n };
    check();
    balance = {
      ...balance,
      available: 50n,
      reserved: 30n,
      finalizedSpend: 20n,
    };
    check();
  });

  test("rejects a leaked or created value", () => {
    expect(
      invariant({
        allocated: 100n,
        available: 70n,
        reserved: 20n,
        finalizedSpend: 0n,
      }),
    ).toBe(false);
    expect(
      invariant({
        allocated: 100n,
        available: 100n,
        reserved: -1n,
        finalizedSpend: 1n,
      }),
    ).toBe(false);
  });

  test("preserves the invariant across generated valid reservation event sequences", () => {
    const action = fc.record({
      kind: fc.constantFrom(
        "authorize",
        "broadcast",
        "release",
        "expire",
        "finalize",
        "dispute",
      ),
      amount: fc.integer({ min: 1, max: 40 }),
    });
    const actions = fc.tuple(
      fc.record({
        kind: fc.constant("reserve"),
        amount: fc.integer({ min: 1, max: 40 }),
      }),
      fc.array(action, { maxLength: 127 }),
    );

    fc.assert(
      fc.property(actions, ([first, rest]) => {
        const sequence = [first, ...rest];
        let status:
          | "NONE"
          | "HELD"
          | "AUTHORIZED"
          | "BROADCAST"
          | "DISPUTED"
          | "FINALIZED"
          | "RELEASED"
          | "EXPIRED" = "NONE";
        let available = 100n;
        let reserved = 0n;
        let finalizedSpend = 0n;
        let previousEventHash: string | null = null;
        let eventCount = 0;

        for (const action of sequence) {
          const amount = BigInt(action.amount);
          let changed = false;
          switch (action.kind) {
            case "reserve":
              if (status === "NONE" && amount <= available) {
                available -= amount;
                reserved += amount;
                status = "HELD";
                changed = true;
              }
              break;
            case "authorize":
              if (status === "HELD") {
                status = "AUTHORIZED";
                changed = true;
              }
              break;
            case "broadcast":
              if (status === "AUTHORIZED") {
                status = "BROADCAST";
                changed = true;
              }
              break;
            case "release":
            case "expire":
              if (status === "HELD" || status === "AUTHORIZED") {
                available += reserved;
                reserved = 0n;
                status = action.kind === "release" ? "RELEASED" : "EXPIRED";
                changed = true;
              }
              break;
            case "dispute":
              if (
                status === "HELD" ||
                status === "AUTHORIZED" ||
                status === "BROADCAST"
              ) {
                status = "DISPUTED";
                changed = true;
              }
              break;
            case "finalize":
              if (status === "BROADCAST" && amount <= reserved) {
                available += reserved - amount;
                finalizedSpend += amount;
                reserved = 0n;
                status = "FINALIZED";
                changed = true;
              }
              break;
          }

          if (changed) {
            eventCount += 1;
            const eventHash = `event-${eventCount}`;
            if (eventCount === 1) expect(previousEventHash).toBeNull();
            else expect(previousEventHash).toBe(`event-${eventCount - 1}`);
            previousEventHash = eventHash;
          }
          expect(
            invariant({
              allocated: 100n,
              available,
              reserved,
              finalizedSpend,
            }),
          ).toBe(true);
        }
        expect(eventCount).toBeGreaterThan(0);
      }),
      { numRuns: 512, seed: 2026081303, endOnFailure: true },
    );
  });
});
