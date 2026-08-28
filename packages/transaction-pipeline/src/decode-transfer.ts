import type {
  Address,
  DecodeFailure,
  DecodeTransferResult,
  DecodedTransfer,
} from "./candidate.js";
import { TRANSFER_SELECTOR } from "./candidate.js";

const WORD_HEX_LENGTH = 64;
const TRANSFER_DATA_HEX_LENGTH = 8 + WORD_HEX_LENGTH * 2;

const failure = (code: DecodeFailure["code"]): DecodeFailure => ({
  ok: false,
  code,
});

/**
 * Decode exactly one canonical ERC-20 transfer without an ABI decoder.
 * This parser intentionally has no external/runtime ABI dependency.
 */
export const decodeTransferIndependent = (
  input: unknown,
): DecodeTransferResult => {
  if (typeof input !== "string" || !/^0x[0-9a-f]*$/.test(input)) {
    return failure("MALFORMED_HEX");
  }
  const dataHexLength = input.length - 2;
  if (dataHexLength % 2 !== 0) return failure("MALFORMED_HEX");
  if (dataHexLength < TRANSFER_DATA_HEX_LENGTH)
    return failure("INVALID_LENGTH");
  if (dataHexLength > TRANSFER_DATA_HEX_LENGTH) return failure("TRAILING_DATA");
  if (input.slice(2, 10) !== TRANSFER_SELECTOR.slice(2)) {
    return failure("UNKNOWN_SELECTOR");
  }

  const addressWord = input.slice(10, 10 + WORD_HEX_LENGTH);
  if (!/^0{24}[0-9a-f]{40}$/.test(addressWord)) {
    return failure("NON_CANONICAL_ADDRESS_PADDING");
  }

  const amountWord = input.slice(74, 74 + WORD_HEX_LENGTH);
  if (!/^[0-9a-f]{64}$/.test(amountWord)) return failure("INVALID_UINT256");

  let amountAtomic: string;
  try {
    amountAtomic = BigInt(`0x${amountWord}`).toString(10);
  } catch {
    return failure("INVALID_UINT256");
  }

  const decoded: DecodedTransfer = {
    ok: true,
    selector: TRANSFER_SELECTOR,
    recipient: `0x${addressWord.slice(24)}` as Address,
    amountAtomic,
  };
  return decoded;
};
