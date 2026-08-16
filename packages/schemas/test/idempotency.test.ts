import { describe, expect, it } from "vitest";

import {
  canonicalizeIdempotencyPayload,
  hashIdempotencyPayload,
} from "../src/index.js";

const payload = {
  action: "asset.transfer",
  amount: { atomic: "500000", displayHint: "0.5" },
  asset: {
    address: "0x1111111111111111111111111111111111111111",
    decimalsHint: 6,
    symbolHint: "TEST_USDC",
    type: "erc20",
  },
  chainId: "eip155:31337",
  expiresAt: "2026-08-10T12:10:00Z",
  idempotencyKey: "merchant-payment-001",
  intentId: "int_local_001",
  metadata: { externalReference: "invoice-test-001" },
  notBefore: "2026-08-10T12:00:00Z",
  objective: "Pay the approved local merchant for the fake invoice",
  recipient: "0x2222222222222222222222222222222222222222",
  schemaVersion: "1.0",
  walletId: "wallet_local_01",
  agentId: "agent_local_01",
  maximumNetworkFee: { asset: "native", atomic: "1000000000000000" },
} as const;

describe("canonical idempotency payload hashing", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalizeIdempotencyPayload({
        z: [{ b: 2, a: 1 }],
        a: "text",
      }),
    ).toBe('{"a":"text","z":[{"a":1,"b":2}]}');
  });

  it("produces the stable versioned SHA-256 payload hash fixture", () => {
    expect(hashIdempotencyPayload(payload)).toBe(
      "sha256:e206d2ccd9c29a7773b8e10f0e75dff0ae87fffb76f8b0ba2823c53788400dbe",
    );
  });

  it("does not change when only input object insertion order changes", () => {
    const reordered = {
      ...payload,
      asset: { ...payload.asset },
      amount: { ...payload.amount },
      metadata: { ...payload.metadata },
      maximumNetworkFee: { ...payload.maximumNetworkFee },
    };

    expect(hashIdempotencyPayload(reordered)).toBe(
      hashIdempotencyPayload(payload),
    );
  });

  it("changes when a business payload field changes", () => {
    expect(
      hashIdempotencyPayload({
        ...payload,
        objective: "different local invoice",
      }),
    ).not.toBe(hashIdempotencyPayload(payload));
  });
});
