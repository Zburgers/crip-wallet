import { describe, expect, it } from "vitest";

import {
  adapterCapabilityRequirementSchema,
  adapterStatusRequestSchema,
  authorizedTransferRequestSchema,
  createAdapterCapabilityMatcher,
  normalizedRecoveryRequestSchema,
  normalizedStatusSchema,
  type AdapterCapabilitySurface,
} from "@crip/adapter-sdk";
import {
  createLocalAnvilReferenceAdapter,
  localAnvilCapabilityManifest,
} from "../src/index.js";

const ids = {
  operationId: "operation_local_01",
  authorizationId: "authorization_local_01",
  adapterRequestId: "adapter_request_local_01",
} as const;

describe("provider-neutral adapter contracts", () => {
  it("accepts only the authorized IDs-only transfer reference", () => {
    expect(authorizedTransferRequestSchema.parse(ids)).toEqual(ids);
    expect(
      authorizedTransferRequestSchema.safeParse({
        ...ids,
        to: "0x0000000000000000000000000000000000000001",
        value: "1",
        calldata: "0x",
      }).success,
    ).toBe(false);
  });

  it("keeps status and recovery requests separate from authorization", () => {
    expect(
      adapterStatusRequestSchema.parse({
        operationId: ids.operationId,
        adapterRequestId: ids.adapterRequestId,
      }),
    ).toEqual({
      operationId: ids.operationId,
      adapterRequestId: ids.adapterRequestId,
    });
    expect(
      normalizedRecoveryRequestSchema.safeParse({
        ...ids,
        authorizationId: ids.authorizationId,
      }).success,
    ).toBe(false);
    expect(
      normalizedStatusSchema.parse({
        operationId: ids.operationId,
        adapterRequestId: ids.adapterRequestId,
        state: "UNKNOWN",
        evidence: "UNTRUSTED",
      }).state,
    ).toBe("UNKNOWN");
  });

  it("has no PostgreSQL requirement in the universal surface", () => {
    const surface: AdapterCapabilitySurface = {
      manifest: () => localAnvilCapabilityManifest,
      getStatus: async () => ({
        operationId: ids.operationId,
        adapterRequestId: ids.adapterRequestId,
        state: "UNKNOWN",
        evidence: "UNTRUSTED",
      }),
      recoverTransaction: async () => ({
        operationId: ids.operationId,
        adapterRequestId: ids.adapterRequestId,
        outcome: "UNKNOWN",
        evidence: "UNTRUSTED",
      }),
    };

    expect(surface.manifest().adapter.id).toBe("local-anvil");
  });

  it("matches only capabilities whose declared grades meet requirements", () => {
    const matches = createAdapterCapabilityMatcher(
      localAnvilCapabilityManifest,
    );
    expect(
      matches(
        adapterCapabilityRequirementSchema.parse({
          chainId: "eip155:31337",
          operation: "asset.transfer",
          minimumEnforcement: {
            totalBudget: "CONTROL_PLANE",
            functionAllowlist: "CONTROL_PLANE",
          },
        }),
      ),
    ).toBe(true);
    expect(
      matches(
        adapterCapabilityRequirementSchema.parse({
          chainId: "eip155:31337",
          operation: "asset.transfer",
          minimumEnforcement: { functionAllowlist: "SIGNER" },
        }),
      ),
    ).toBe(false);
    expect(
      matches(
        adapterCapabilityRequirementSchema.parse({
          chainId: "eip155:1",
          operation: "asset.transfer",
        }),
      ),
    ).toBe(false);
  });
});

describe("local Anvil reference capability", () => {
  it("exposes only the local IDs-only transfer operation and truthful manifest", async () => {
    const received: unknown[] = [];
    const adapter = createLocalAnvilReferenceAdapter({
      signAuthorizedTransfer: async (request) => {
        received.push(request);
        return { transactionHash: `0x${"a".repeat(64)}` };
      },
      getStatus: async () => ({
        operationId: ids.operationId,
        adapterRequestId: ids.adapterRequestId,
        state: "UNKNOWN",
        evidence: "UNTRUSTED",
      }),
      recoverTransaction: async () => ({
        operationId: ids.operationId,
        adapterRequestId: ids.adapterRequestId,
        outcome: "UNKNOWN",
        evidence: "UNTRUSTED",
      }),
    });

    expect(adapter.manifest()).toEqual(localAnvilCapabilityManifest);
    expect(adapter.manifest().chains).toEqual(["eip155:31337"]);
    expect(adapter.manifest().operations).toMatchObject({
      readState: true,
      erc20Transfer: true,
      arbitraryCall: false,
      typedData: false,
    });
    expect(Object.keys(adapter).sort()).toEqual([
      "getStatus",
      "manifest",
      "recoverTransaction",
      "signAuthorizedTransfer",
    ]);

    await expect(adapter.signAuthorizedTransfer(ids)).resolves.toEqual({
      transactionHash: `0x${"a".repeat(64)}`,
    });
    expect(received).toEqual([ids]);
  });

  it.each([
    {
      ...ids,
      transaction: { to: "0x0000000000000000000000000000000000000001" },
    },
    { ...ids, rawTransaction: "0xdeadbeef" },
    { ...ids, digest: `0x${"a".repeat(64)}` },
    { ...ids, message: "sign this" },
    { ...ids, typedData: {} },
  ])(
    "rejects unsupported caller-supplied signing request %j",
    async (request) => {
      const adapter = createLocalAnvilReferenceAdapter({
        signAuthorizedTransfer: async () => ({
          transactionHash: `0x${"a".repeat(64)}`,
        }),
        getStatus: async () => ({
          operationId: ids.operationId,
          adapterRequestId: ids.adapterRequestId,
          state: "UNKNOWN",
          evidence: "UNTRUSTED",
        }),
        recoverTransaction: async () => ({
          operationId: ids.operationId,
          adapterRequestId: ids.adapterRequestId,
          outcome: "UNKNOWN",
          evidence: "UNTRUSTED",
        }),
      });

      await expect(adapter.signAuthorizedTransfer(request)).rejects.toThrow();
    },
  );
});
