import { generateKeyPairSync, sign } from "node:crypto";

import {
  serializeLocalOwnerApprovalAuthentication,
  type LocalOwnerApprovalAuthentication,
} from "@crip/approvals";

export interface LocalOwnerTestAuthenticationInput {
  approvalId: string;
  envelopeHash: string;
  policyId: string;
  policyVersion: number;
  expiresAt: string;
  nonce: string;
}

export const createLocalOwnerTestCredential = (
  ownerId: string,
  keyId: string,
) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();

  return {
    ownerId,
    keyId,
    publicKeyPem,
    authenticate(
      input: LocalOwnerTestAuthenticationInput,
    ): LocalOwnerApprovalAuthentication {
      const payload = {
        ...input,
        approverId: ownerId,
        keyId,
      };
      return {
        ...payload,
        signature: sign(
          null,
          serializeLocalOwnerApprovalAuthentication(payload),
          privateKey,
        ).toString("base64url"),
      };
    },
  };
};
