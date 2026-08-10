import { describe, expect, it } from "vitest";

import {
  atomicUnitSchema,
  canonicalIntentSchema,
  positiveAtomicUnitSchema,
} from "../src/index.js";

const transferIntent = {
  schemaVersion: "1.0",
  intentId: "int_local_001",
  idempotencyKey: "merchant-payment-001",
  agentId: "agent_local_01",
  walletId: "wallet_local_01",
  chainId: "eip155:31337",
  action: "asset.transfer",
  objective: "Pay the approved local merchant for the fake invoice",
  asset: {
    type: "erc20",
    address: "0x1111111111111111111111111111111111111111",
    symbolHint: "TEST_USDC",
    decimalsHint: 6,
  },
  amount: {
    atomic: "500000",
    displayHint: "0.5",
  },
  recipient: "0x2222222222222222222222222222222222222222",
  maximumNetworkFee: {
    asset: "native",
    atomic: "1000000000000000",
  },
  notBefore: "2026-08-10T12:00:00Z",
  expiresAt: "2026-08-10T12:10:00Z",
  metadata: {
    externalReference: "invoice-test-001",
  },
} as const;

describe("atomic unit schemas", () => {
  it.each([
    "0",
    "1",
    "500000",
    "1000000000000000000000000000000",
    "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  ])("accepts canonical nonnegative integer string %s", (value) => {
    expect(atomicUnitSchema.parse(value)).toBe(value);
  });

  it.each([
    "",
    "00",
    "01",
    "-1",
    "+1",
    "1.0",
    "1e3",
    "1".repeat(10_000),
    "115792089237316195423570985008687907853269984665640564039457584007913129639936",
    1,
    1.5,
  ])("rejects noncanonical or non-string atomic value %j", (value) => {
    expect(atomicUnitSchema.safeParse(value).success).toBe(false);
  });

  it("requires positive transfer amounts while allowing a zero fee ceiling", () => {
    expect(positiveAtomicUnitSchema.safeParse("0").success).toBe(false);
    expect(positiveAtomicUnitSchema.parse("1")).toBe("1");
  });
});

describe("canonicalIntentSchema", () => {
  it("accepts the strict provider-neutral transfer intent", () => {
    expect(canonicalIntentSchema.parse(transferIntent)).toEqual(transferIntent);
  });

  it("accepts the read-only MVP intent without transfer authority", () => {
    const readIntent = {
      schemaVersion: "1.0",
      intentId: "int_local_read_001",
      idempotencyKey: "read-wallet-001",
      agentId: "agent_local_01",
      walletId: "wallet_local_01",
      chainId: "eip155:31337",
      action: "wallet.read_state",
      objective: "Read fake local wallet state",
      notBefore: "2026-08-10T12:00:00Z",
      expiresAt: "2026-08-10T12:10:00Z",
      metadata: {},
    };

    expect(canonicalIntentSchema.parse(readIntent)).toEqual(readIntent);
  });

  it.each([
    ["unknown top-level field", { ...transferIntent, rawCalldata: "0x" }],
    [
      "unknown nested asset field",
      { ...transferIntent, asset: { ...transferIntent.asset, trusted: true } },
    ],
    [
      "numeric amount",
      {
        ...transferIntent,
        amount: { ...transferIntent.amount, atomic: 500000 },
      },
    ],
    [
      "fractional amount",
      {
        ...transferIntent,
        amount: { ...transferIntent.amount, atomic: "0.5" },
      },
    ],
    [
      "oversized display hint",
      {
        ...transferIntent,
        amount: { ...transferIntent.amount, displayHint: "1".repeat(161) },
      },
    ],
    [
      "mixed-case address",
      {
        ...transferIntent,
        recipient: "0x22222222222222222222222222222222222222AA",
      },
    ],
    ["malformed CAIP-2 chain", { ...transferIntent, chainId: "31337" }],
    [
      "hyphenated CAIP-2 namespace",
      { ...transferIntent, chainId: "eip-155:31337" },
    ],
    [
      "punctuation-only CAIP-2 namespace",
      { ...transferIntent, chainId: "---:x" },
    ],
    ["unknown action", { ...transferIntent, action: "contract.call" }],
    [
      "non-UTC offset timestamp",
      { ...transferIntent, expiresAt: "2026-08-10T17:40:00+05:30" },
    ],
    [
      "expiry before not-before",
      { ...transferIntent, expiresAt: "2026-08-10T11:59:59Z" },
    ],
  ])("rejects %s", (_name, candidate) => {
    expect(canonicalIntentSchema.safeParse(candidate).success).toBe(false);
  });
});
