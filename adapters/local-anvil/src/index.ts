import {
  adapterStatusRequestSchema,
  authorizedTransferRequestSchema,
  authorizedTransferResultSchema,
  normalizedChainEvidenceSchema,
  normalizedRecoveryRequestSchema,
  normalizedStatusSchema,
  type AdapterCapabilitySurface,
  type AdapterStatusRequest,
  type AuthorizedTransferResult,
  type NormalizedChainEvidence,
  type NormalizedRecoveryRequest,
  type NormalizedStatus,
  type SignAuthorizedTransferRequest,
} from "@crip/adapter-sdk";
import { adapterCapabilityManifestSchema } from "@crip/schemas";

export const LOCAL_ANVIL_CHAIN_ID = "eip155:31337" as const;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
};

/** Truthful local-only capability declaration; no production custody claim. */
export const localAnvilCapabilityManifest = deepFreeze(
  adapterCapabilityManifestSchema.parse({
    adapter: { id: "local-anvil", version: "0.0.0" },
    chains: [LOCAL_ANVIL_CHAIN_ID],
    custody: {
      model: "disposable-local-test-key",
      ownerKeyExposedToAgent: false,
    },
    operations: {
      readState: true,
      erc20Transfer: true,
      arbitraryCall: false,
      typedData: false,
    },
    enforcement: {
      totalBudget: "CONTROL_PLANE",
      perTransactionBudget: "CONTROL_PLANE",
      chainAllowlist: "CONTROL_PLANE",
      recipientAllowlist: "CONTROL_PLANE",
      functionAllowlist: "CONTROL_PLANE",
      expiry: "CONTROL_PLANE",
    },
    approvals: { asynchronous: true },
    simulation: { supported: true },
  }),
);

export type LocalAnvilExecutionAdapter = AdapterCapabilitySurface & {
  signAuthorizedTransfer(
    request: SignAuthorizedTransferRequest,
  ): Promise<AuthorizedTransferResult>;
};

export type LocalAnvilCapability = LocalAnvilExecutionAdapter;

export interface LocalAnvilReferenceHandlers {
  signAuthorizedTransfer: (
    request: SignAuthorizedTransferRequest,
  ) => Promise<AuthorizedTransferResult>;
  getStatus: (request: AdapterStatusRequest) => Promise<NormalizedStatus>;
  recoverTransaction: (
    request: NormalizedRecoveryRequest,
  ) => Promise<NormalizedChainEvidence>;
}

/**
 * Build the local reference shape without implementing signing, RPC, or state
 * loading. P2-04C supplies the isolated execution handler behind this facade.
 */
export const createLocalAnvilReferenceAdapter = (
  handlers: LocalAnvilReferenceHandlers,
): LocalAnvilExecutionAdapter =>
  Object.freeze({
    manifest: () => localAnvilCapabilityManifest,
    signAuthorizedTransfer: async (request: SignAuthorizedTransferRequest) =>
      authorizedTransferResultSchema.parse(
        await handlers.signAuthorizedTransfer(
          authorizedTransferRequestSchema.parse(request),
        ),
      ),
    getStatus: async (request: AdapterStatusRequest) =>
      normalizedStatusSchema.parse(
        await handlers.getStatus(adapterStatusRequestSchema.parse(request)),
      ),
    recoverTransaction: async (request: NormalizedRecoveryRequest) =>
      normalizedChainEvidenceSchema.parse(
        await handlers.recoverTransaction(
          normalizedRecoveryRequestSchema.parse(request),
        ),
      ),
  });

export type {
  AdapterCapabilitySurface,
  AdapterStatusRequest,
  AuthorizedTransferResult,
  NormalizedChainEvidence,
  NormalizedRecoveryRequest,
  NormalizedStatus,
  SignAuthorizedTransferRequest,
} from "@crip/adapter-sdk";
