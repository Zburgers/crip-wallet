import { z } from "zod";

const canonicalAtomicPattern = /^(?:0|[1-9][0-9]*)$/;
const maximumUint256Decimal =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

const isWithinUint256 = (value: string): boolean => {
  if (!canonicalAtomicPattern.test(value)) return true;
  if (value.length !== maximumUint256Decimal.length) {
    return value.length < maximumUint256Decimal.length;
  }
  return value <= maximumUint256Decimal;
};

/** Canonical nonnegative integer atomic units, bounded to an unsigned 256-bit digit width. */
export const atomicUnitSchema = z
  .string()
  .max(78)
  .regex(canonicalAtomicPattern)
  .refine(isWithinUint256, "amount exceeds uint256");

/** Canonical positive integer atomic units for value-moving intent amounts. */
export const positiveAtomicUnitSchema = atomicUnitSchema.refine(
  (value) => value !== "0",
  "amount must be greater than zero",
);

/** A validated canonical atomic-unit string. */
export type AtomicUnit = z.infer<typeof atomicUnitSchema>;
