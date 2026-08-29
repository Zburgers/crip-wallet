import { z } from "zod";

import {
  adapterCapabilityManifestSchema,
  enforcementGradeSchema,
  meetsMinimumEnforcementGrade,
  type AdapterCapabilityManifest,
  type EnforcementGrade,
} from "@crip/schemas";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const operationSchema = z.enum(["wallet.read_state", "asset.transfer"]);

/** The only operation reference accepted by an authorized local transfer. */
export const authorizedTransferRequestSchema = z.strictObject({
  operationId: identifierSchema,
  authorizationId: identifierSchema,
  adapterRequestId: identifierSchema,
});

/** Alias matching the Phase-2 plan's local adapter request name. */
export const signAuthorizedTransferRequestSchema =
  authorizedTransferRequestSchema;

export type AuthorizedTransferRequest = z.infer<
  typeof authorizedTransferRequestSchema
>;
export type SignAuthorizedTransferRequest = AuthorizedTransferRequest;

const transactionHashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);

/** Safe result reference; raw signed bytes never belong to this contract. */
export const authorizedTransferResultSchema = z.strictObject({
  transactionHash: transactionHashSchema,
});

export type AuthorizedTransferResult = z.infer<
  typeof authorizedTransferResultSchema
>;

export const adapterStatusRequestSchema = z.strictObject({
  operationId: identifierSchema,
  adapterRequestId: identifierSchema,
});

export type AdapterStatusRequest = z.infer<typeof adapterStatusRequestSchema>;

const adapterStatusStateSchema = z.enum([
  "UNKNOWN",
  "PENDING",
  "CONFIRMED",
  "FAILED",
  "DISPUTED",
]);
const evidenceTrustSchema = z.enum(["UNTRUSTED", "AUTHENTICATED"]);

/** Normalized provider status; it carries no authorization authority. */
export const normalizedStatusSchema = z.strictObject({
  operationId: identifierSchema,
  adapterRequestId: identifierSchema,
  state: adapterStatusStateSchema,
  evidence: evidenceTrustSchema,
});

export type NormalizedStatus = z.infer<typeof normalizedStatusSchema>;

export const normalizedRecoveryRequestSchema = z.strictObject({
  operationId: identifierSchema,
  adapterRequestId: identifierSchema,
});

export type NormalizedRecoveryRequest = z.infer<
  typeof normalizedRecoveryRequestSchema
>;

export const normalizedChainEvidenceSchema = z.strictObject({
  operationId: identifierSchema,
  adapterRequestId: identifierSchema,
  outcome: z.enum([
    "UNKNOWN",
    "NOT_FOUND",
    "PENDING",
    "CONFIRMED",
    "FAILED",
    "CONFLICT",
  ]),
  evidence: evidenceTrustSchema,
});

export type NormalizedChainEvidence = z.infer<
  typeof normalizedChainEvidenceSchema
>;

const enforcementRequirementSchema = z.strictObject({
  totalBudget: enforcementGradeSchema.optional(),
  perTransactionBudget: enforcementGradeSchema.optional(),
  chainAllowlist: enforcementGradeSchema.optional(),
  recipientAllowlist: enforcementGradeSchema.optional(),
  functionAllowlist: enforcementGradeSchema.optional(),
  expiry: enforcementGradeSchema.optional(),
});

export const adapterCapabilityRequirementSchema = z.strictObject({
  chainId: z.string().regex(/^[a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/),
  operation: operationSchema,
  minimumEnforcement: enforcementRequirementSchema.optional(),
});

export type AdapterCapabilityRequirement = z.infer<
  typeof adapterCapabilityRequirementSchema
>;

/** Provider-neutral adapter boundary; it contains no persistence dependency. */
export interface AdapterCapabilitySurface {
  manifest(): AdapterCapabilityManifest;
  getStatus(request: AdapterStatusRequest): Promise<NormalizedStatus>;
  recoverTransaction(
    request: NormalizedRecoveryRequest,
  ): Promise<NormalizedChainEvidence>;
}

/** Authorized execution is intentionally a capability-specific method. */
export interface AuthorizedTransferAdapter extends AdapterCapabilitySurface {
  signAuthorizedTransfer(
    request: SignAuthorizedTransferRequest,
  ): Promise<AuthorizedTransferResult>;
}

const enforcementKeys = [
  "totalBudget",
  "perTransactionBudget",
  "chainAllowlist",
  "recipientAllowlist",
  "functionAllowlist",
  "expiry",
] as const satisfies readonly (keyof AdapterCapabilityManifest["enforcement"])[];

const operationIsSupported = (
  manifest: AdapterCapabilityManifest,
  operation: AdapterCapabilityRequirement["operation"],
): boolean =>
  operation === "wallet.read_state"
    ? manifest.operations.readState
    : manifest.operations.erc20Transfer;

const manifestMeetsRequirement = (
  manifest: AdapterCapabilityManifest,
  requirement: AdapterCapabilityRequirement,
): boolean => {
  if (
    !manifest.chains.includes(requirement.chainId) ||
    !operationIsSupported(manifest, requirement.operation)
  ) {
    return false;
  }

  for (const key of enforcementKeys) {
    const required = requirement.minimumEnforcement?.[key];
    if (
      required !== undefined &&
      !meetsMinimumEnforcementGrade(manifest.enforcement[key], required)
    ) {
      return false;
    }
  }

  return true;
};

/** Parse and match a manifest; invalid or unsupported claims fail closed. */
export const supportsAdapterCapability = (
  manifestInput: unknown,
  requirementInput: unknown,
): boolean => {
  const manifest = adapterCapabilityManifestSchema.safeParse(manifestInput);
  const requirement =
    adapterCapabilityRequirementSchema.safeParse(requirementInput);
  return (
    manifest.success &&
    requirement.success &&
    manifestMeetsRequirement(manifest.data, requirement.data)
  );
};

/** Compile a validated manifest into a fail-closed capability matcher. */
export const createAdapterCapabilityMatcher = (
  manifestInput: unknown,
): ((requirementInput: unknown) => boolean) => {
  const manifest = adapterCapabilityManifestSchema.parse(manifestInput);
  return (requirementInput) => {
    const requirement =
      adapterCapabilityRequirementSchema.safeParse(requirementInput);
    return (
      requirement.success &&
      manifestMeetsRequirement(manifest, requirement.data)
    );
  };
};

export {
  adapterCapabilityManifestSchema,
  type AdapterCapabilityManifest,
  enforcementGradeSchema,
  type EnforcementGrade,
};
