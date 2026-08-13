import { z } from "zod";

import { enforcementGradeSchema } from "./enforcement-grade.js";
import { canonicalIdentifierSchema, semverSchema } from "./common.js";
import { chainIdSchema } from "./intent.js";

/** Machine-readable, truthful adapter capability declaration. */
export const adapterCapabilityManifestSchema = z.strictObject({
  adapter: z.strictObject({
    id: canonicalIdentifierSchema,
    version: semverSchema,
  }),
  chains: z.array(chainIdSchema).min(1),
  custody: z.strictObject({
    model: z.enum([
      "disposable-local-test-key",
      "external-provider",
      "smart-account",
      "signer-policy",
    ]),
    ownerKeyExposedToAgent: z.literal(false),
  }),
  operations: z.strictObject({
    readState: z.boolean(),
    erc20Transfer: z.boolean(),
    arbitraryCall: z.boolean(),
    typedData: z.boolean(),
  }),
  enforcement: z.strictObject({
    totalBudget: enforcementGradeSchema,
    perTransactionBudget: enforcementGradeSchema,
    chainAllowlist: enforcementGradeSchema,
    recipientAllowlist: enforcementGradeSchema,
    functionAllowlist: enforcementGradeSchema,
    expiry: enforcementGradeSchema,
  }),
  approvals: z.strictObject({ asynchronous: z.boolean() }),
  simulation: z.strictObject({ supported: z.boolean() }),
});

export const capabilityManifestSchema = adapterCapabilityManifestSchema;
export type AdapterCapabilityManifest = z.infer<
  typeof adapterCapabilityManifestSchema
>;
