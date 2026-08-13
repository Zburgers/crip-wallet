import { z } from "zod";

export const canonicalIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const semverSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/);

export const canonicalHashSchema = z.union([
  z.string().regex(/^0x[0-9a-f]{64}$/),
  z.string().regex(/^sha256:[0-9a-f]{64}$/),
]);

export const evmHashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);

export const utcSecondSchema = z.iso.datetime({ offset: false, precision: 0 });

export const versionSchema = z.literal("1.0");
