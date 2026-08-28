import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  constructTransferCore,
  decodeTransferIndependent,
  verifyTransferCore,
  type TrustedExecutionContext,
} from "../src/index.js";

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const token = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const intent = {
  schemaVersion: "1.0",
  intentId: "int_local_001",
  idempotencyKey: "transfer-001",
  agentId: "agent_local_01",
  walletId: "wallet_local_01",
  chainId: "eip155:31337",
  action: "asset.transfer",
  objective: "Pay the local fake merchant",
  asset: {
    type: "erc20",
    address: token,
    symbolHint: "IGNORED_SYMBOL",
    decimalsHint: 6,
  },
  amount: { atomic: "500000", displayHint: "0.5" },
  recipient,
  maximumNetworkFee: { asset: "native", atomic: "0" },
  notBefore: "2026-08-28T12:00:00Z",
  expiresAt: "2026-08-28T12:10:00Z",
  metadata: {},
} as const;
const provenance = {
  operationId: "op_local_001",
  policyId: "policy_local_01",
  policyVersion: 1,
  policyDecisionHash: `0x${"1".repeat(64)}`,
} as const;
const trusted = {
  walletAddress: wallet,
  tokenAddress: token,
  chainId: "eip155:31337",
  fixtureInstanceId: "fixture-local-001",
  provenance,
} as const satisfies TrustedExecutionContext;
const expectedCalldata =
  "0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000007a120" as const;
const buildCandidate = () => constructTransferCore(intent, trusted);

describe("P2-02BCD transfer core", () => {
  it("constructs one exact transfer candidate from canonical intent", () => {
    expect(buildCandidate()).toEqual({
      action: "asset.transfer",
      chainId: "eip155:31337",
      from: wallet,
      target: token,
      nativeValue: "0",
      calldata: expectedCalldata,
      selector: "0xa9059cbb",
      recipient,
      amountAtomic: "500000",
      nonceStrategy: "pending",
      fixtureInstanceId: "fixture-local-001",
      provenance: {
        intentId: "int_local_001",
        agentId: "agent_local_01",
        walletId: "wallet_local_01",
        ...provenance,
      },
    });
  });

  it("does not use caller symbol or decimals hints as authority", () => {
    expect(
      constructTransferCore(
        {
          ...intent,
          asset: { ...intent.asset, symbolHint: "WRONG", decimalsHint: 18 },
        },
        trusted,
      ).calldata,
    ).toBe(expectedCalldata);
  });

  it("decodes canonical transfer bytes without an ABI decoder", () => {
    expect(decodeTransferIndependent(expectedCalldata)).toEqual({
      ok: true,
      selector: "0xa9059cbb",
      recipient,
      amountAtomic: "500000",
    });
  });

  it.each([
    ["short data", "0xa9059cbb", "INVALID_LENGTH"],
    ["long data", `${expectedCalldata}00`, "TRAILING_DATA"],
    ["odd hex", "0xa9059cbb0", "MALFORMED_HEX"],
    [
      "malformed hex",
      expectedCalldata.replace("a905", "a90x"),
      "MALFORMED_HEX",
    ],
    [
      "unknown selector",
      `0xdeadbeef${expectedCalldata.slice(10)}`,
      "UNKNOWN_SELECTOR",
    ],
    [
      "nonzero address padding",
      `0xa9059cbb01${expectedCalldata.slice(12)}`,
      "NON_CANONICAL_ADDRESS_PADDING",
    ],
    ["opaque data", "0x1234567890abcdef", "INVALID_LENGTH"],
    [
      "multicall selector",
      `0x12345678${expectedCalldata.slice(10)}`,
      "UNKNOWN_SELECTOR",
    ],
  ] as const)("rejects %s", (_name, calldata, code) => {
    expect(decodeTransferIndependent(calldata)).toEqual({ ok: false, code });
  });

  it.each([
    ["zero", "0".repeat(64), "0"],
    [
      "uint256 maximum",
      "f".repeat(64),
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    ],
  ] as const)(
    "decodes %s uint256 amount",
    (_name, amountWord, amountAtomic) => {
      const calldata = `${expectedCalldata.slice(0, 74)}${amountWord}`;
      expect(decodeTransferIndependent(calldata)).toMatchObject({
        ok: true,
        amountAtomic,
      });
    },
  );

  it("verifies the constructed core and retains provenance", () => {
    const candidate = buildCandidate();
    const decoded = decodeTransferIndependent(candidate.calldata);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(verifyTransferCore(intent, candidate, decoded, trusted)).toEqual({
      ok: true,
      verified: candidate,
    });
  });

  it.each([
    ["recipient", { recipient: "0x3333333333333333333333333333333333333333" }],
    ["amount", { amountAtomic: "500001" }],
    ["target", { target: "0x3333333333333333333333333333333333333333" }],
    ["sender", { from: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
    ["chain", { chainId: "eip155:1" }],
    ["fixture", { fixtureInstanceId: "fixture-local-002" }],
    ["native value", { nativeValue: "1" }],
    ["nonce strategy", { nonceStrategy: "latest" }],
    ["selector", { selector: "0xdeadbeef" }],
    ["action", { action: "wallet.read_state" }],
  ] as const)("fails closed when candidate %s changes", (_name, mutation) => {
    const candidate = buildCandidate();
    const decoded = decodeTransferIndependent(candidate.calldata);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(
      verifyTransferCore(
        intent,
        { ...candidate, ...mutation },
        decoded,
        trusted,
      ),
    ).toMatchObject({ ok: false });
  });

  it("fails closed when calldata changes even if stale decoded data is supplied", () => {
    const candidate = buildCandidate();
    const decoded = decodeTransferIndependent(candidate.calldata);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(
      verifyTransferCore(
        intent,
        { ...candidate, calldata: `${candidate.calldata.slice(0, -1)}1` },
        decoded,
        trusted,
      ),
    ).toMatchObject({ ok: false });
  });

  it("fails closed when trusted policy or operation provenance changes", () => {
    const candidate = buildCandidate();
    const decoded = decodeTransferIndependent(candidate.calldata);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    for (const changed of [
      { ...trusted, provenance: { ...provenance, operationId: "op_other" } },
      {
        ...trusted,
        provenance: {
          ...provenance,
          policyDecisionHash: `0x${"2".repeat(64)}`,
        },
      },
    ])
      expect(
        verifyTransferCore(intent, candidate, decoded, changed),
      ).toMatchObject({ ok: false });
  });

  it("rejects every one-nibble mutation of the exact calldata", () => {
    const candidate = buildCandidate();
    const decoded = decodeTransferIndependent(candidate.calldata);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: candidate.calldata.length - 1 }),
        fc.constantFrom(..."0123456789abcdef".split("")),
        (index, replacement) => {
          fc.pre(candidate.calldata[index] !== replacement);
          const mutated = `${candidate.calldata.slice(0, index)}${replacement}${candidate.calldata.slice(index + 1)}`;
          return !verifyTransferCore(
            intent,
            { ...candidate, calldata: mutated },
            decoded,
            trusted,
          ).ok;
        },
      ),
      { numRuns: 128 },
    );
  });
});
