import { createHash } from "node:crypto";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const IDEMPOTENCY_PAYLOAD_DOMAIN = "crip/idempotency-payload/v1\u0000";

const canonicalizeJsonValue = (value: JsonValue): string => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON does not support non-finite numbers");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJsonValue).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalizeJsonValue(value[key] as JsonValue)}`,
    )
    .join(",")}}`;
};

/** Serialize JSON-compatible data using deterministic RFC 8785-style key ordering. */
export const canonicalizeIdempotencyPayload = (payload: JsonValue): string =>
  canonicalizeJsonValue(payload);

/** Hash canonical idempotency bytes with an explicit versioned domain separator. */
export const hashIdempotencyPayload = (payload: JsonValue): string =>
  `sha256:${createHash("sha256")
    .update(IDEMPOTENCY_PAYLOAD_DOMAIN, "utf8")
    .update(canonicalizeIdempotencyPayload(payload), "utf8")
    .digest("hex")}`;
