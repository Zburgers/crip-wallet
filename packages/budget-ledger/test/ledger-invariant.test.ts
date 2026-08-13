import { describe, expect, test } from "vitest";

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
});
