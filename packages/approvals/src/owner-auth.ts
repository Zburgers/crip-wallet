export interface LocalOwnerApprovalAuthenticationPayload {
  approvalId: string;
  approverId: string;
  keyId: string;
  envelopeHash: string;
  policyId: string;
  policyVersion: number;
  expiresAt: string;
  nonce: string;
}

export interface LocalOwnerApprovalAuthentication extends LocalOwnerApprovalAuthenticationPayload {
  signature: string;
}

const canonicalTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError("owner approval authentication expiry is invalid");
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
};

/**
 * ADR-0008 local-test signing payload.
 *
 * This function deliberately contains no signing key access. The owner-side
 * loopback/test surface may use the returned bytes with its local private key;
 * agent-facing code receives only the resulting signed artifact.
 */
export const serializeLocalOwnerApprovalAuthentication = (
  value: LocalOwnerApprovalAuthenticationPayload,
): Buffer =>
  Buffer.from(
    JSON.stringify([
      "crip/local-owner-approval/v1",
      value.approvalId,
      value.approverId,
      value.keyId,
      value.envelopeHash,
      value.policyId,
      value.policyVersion,
      canonicalTimestamp(value.expiresAt),
      value.nonce,
    ]),
    "utf8",
  );
