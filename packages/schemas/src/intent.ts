import { z } from "zod";

import { atomicUnitSchema, positiveAtomicUnitSchema } from "./money.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

/** A syntactically valid CAIP-2 chain identifier; policy performs chain authorization. */
export const chainIdSchema = z
  .string()
  .regex(/^[a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/);

/** Canonical MVP EVM address representation: exactly 20 lowercase hex bytes. */
export const evmAddressSchema = z.string().regex(/^0x[a-f0-9]{40}$/);

const utcSecondSchema = z.iso.datetime({ offset: false, precision: 0 });

const metadataSchema = z.strictObject({
  externalReference: z.string().min(1).max(256).optional(),
});

const commonIntentShape = {
  schemaVersion: z.literal("1.0"),
  intentId: identifierSchema,
  idempotencyKey: identifierSchema,
  agentId: identifierSchema,
  walletId: identifierSchema,
  chainId: chainIdSchema,
  objective: z.string().min(1).max(512),
  notBefore: utcSecondSchema,
  expiresAt: utcSecondSchema,
  metadata: metadataSchema,
} as const;

const readStateIntentSchema = z.strictObject({
  ...commonIntentShape,
  action: z.literal("wallet.read_state"),
});

const transferIntentSchema = z.strictObject({
  ...commonIntentShape,
  action: z.literal("asset.transfer"),
  asset: z.strictObject({
    type: z.literal("erc20"),
    address: evmAddressSchema,
    symbolHint: z.string().min(1).max(32).optional(),
    decimalsHint: z.number().int().min(0).max(255).optional(),
  }),
  amount: z.strictObject({
    atomic: positiveAtomicUnitSchema,
    // This bounded hint is never an input to authorization or atomic-unit math.
    displayHint: z
      .string()
      .max(160)
      .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/)
      .optional(),
  }),
  recipient: evmAddressSchema,
  maximumNetworkFee: z.strictObject({
    asset: z.literal("native"),
    atomic: atomicUnitSchema,
  }),
});

/** Strict versioned MVP intent union; no raw calldata or generic call branch exists. */
export const canonicalIntentSchema = z
  .discriminatedUnion("action", [readStateIntentSchema, transferIntentSchema])
  .superRefine((intent, context) => {
    if (Date.parse(intent.notBefore) >= Date.parse(intent.expiresAt)) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must be later than notBefore",
        path: ["expiresAt"],
      });
    }
  });

/** A validated provider-neutral MVP intent. */
export type CanonicalIntent = z.infer<typeof canonicalIntentSchema>;
