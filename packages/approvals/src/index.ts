import { createPublicKey, verify } from "node:crypto";

import type { Pool } from "pg";

import {
  ApprovalError,
  approveApproval as approveApprovalAfterAuthentication,
  type ApprovalAuditContext,
  type ApprovalSnapshot,
} from "./core.js";
import {
  serializeLocalOwnerApprovalAuthentication,
  type LocalOwnerApprovalAuthentication,
} from "./owner-auth.js";

export * from "./control.js";
export { ApprovalError };
export {
  authorizeAutonomous,
  consumeApproval,
  createApprovalRequest,
  rejectApproval,
  replaceExecutionEnvelope,
  revokeApproval,
} from "./core.js";
export type {
  ApprovalErrorCode,
  ApprovalStatus,
  AuthorizationKind,
  AuthorizationEvidence,
  AuthorizeAutonomousInput,
  ConsumeApprovalRequest,
  CreateApprovalRequest,
  RejectApprovalRequest,
  ReplaceExecutionEnvelopeRequest,
  RevokeApprovalRequest,
} from "./core.js";
export type { ApprovalAuditContext, ApprovalSnapshot };
export {
  serializeLocalOwnerApprovalAuthentication,
  type LocalOwnerApprovalAuthentication,
  type LocalOwnerApprovalAuthenticationPayload,
} from "./owner-auth.js";

export interface ApproveApprovalRequest {
  approvalId: string;
  authentication: LocalOwnerApprovalAuthentication;
  now?: string | Date;
  audit: ApprovalAuditContext;
}

type ApprovalAuthenticationBinding = {
  envelope_hash: string;
  policy_id: string;
  policy_version: number;
  expires_at: Date | string;
  nonce: string;
  owner_id: string;
};

type TrustedOwnerKey = {
  algorithm: string;
  public_key: string;
};

type PersistedAuthentication = {
  authentication_id: string;
  owner_id: string;
  approver_id: string;
  key_id: string;
  envelope_hash: string;
  policy_id: string;
  policy_version: number;
  expires_at: Date | string;
  nonce: string;
  signature: string;
  consumed_at: Date | string | null;
};

const canonicalId = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      `${label} is not canonical`,
    );
  }
  return value;
};

const canonicalHash = (value: string, label: string): string => {
  if (!/^0x[0-9a-f]{64}$/.test(value)) {
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      `${label} is not a canonical EVM hash`,
    );
  }
  return value;
};

const canonicalTimestamp = (value: string | Date, label: string): string => {
  const parsed =
    value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      `${label} must be a valid timestamp`,
    );
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const invalidAuthentication = (): ApprovalError =>
  new ApprovalError(
    "APPROVAL_INVALID_STATE",
    "owner approval authentication is invalid",
  );

const assertAuthenticationMatches = (
  row: PersistedAuthentication,
  authenticationId: string,
  authentication: LocalOwnerApprovalAuthentication,
): void => {
  if (
    row.authentication_id !== authenticationId ||
    row.owner_id !== authentication.approverId ||
    row.approver_id !== authentication.approverId ||
    row.key_id !== authentication.keyId ||
    row.envelope_hash !== authentication.envelopeHash ||
    row.policy_id !== authentication.policyId ||
    row.policy_version !== authentication.policyVersion ||
    canonicalTimestamp(row.expires_at, "persisted authentication expiry") !==
      canonicalTimestamp(authentication.expiresAt, "authentication expiry") ||
    row.nonce !== authentication.nonce ||
    row.signature !== authentication.signature ||
    row.consumed_at !== null
  ) {
    throw new ApprovalError(
      "APPROVAL_CONFLICT",
      "approval ID is already bound to different owner authentication evidence",
    );
  }
};

/**
 * ADR-0008 local-test owner authentication boundary.
 *
 * The caller supplies a signed decision artifact. The trusted public key is
 * loaded from local bootstrap state persisted in the database; this API never
 * accepts, returns, or derives owner private-key material.
 */
export const approveApproval = async (
  pool: Pool,
  request: ApproveApprovalRequest,
): Promise<ApprovalSnapshot> => {
  canonicalId(request.approvalId, "approvalId");
  const authentication = request.authentication;
  if (!authentication) throw invalidAuthentication();
  canonicalId(authentication.approvalId, "authentication.approvalId");
  canonicalId(authentication.approverId, "authentication.approverId");
  canonicalId(authentication.keyId, "authentication.keyId");
  canonicalId(authentication.policyId, "authentication.policyId");
  canonicalId(authentication.nonce, "authentication.nonce");
  canonicalHash(authentication.envelopeHash, "authentication.envelopeHash");
  if (
    !Number.isInteger(authentication.policyVersion) ||
    authentication.policyVersion <= 0
  ) {
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "authentication.policyVersion must be positive",
    );
  }
  if (request.approvalId !== authentication.approvalId) {
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "authentication is bound to a different approval ID",
    );
  }
  if (
    request.audit.actorType !== "owner" ||
    request.audit.actorId !== authentication.approverId
  ) {
    throw invalidAuthentication();
  }

  const now = canonicalTimestamp(request.now ?? new Date(), "approval time");
  const authenticationExpiry = canonicalTimestamp(
    authentication.expiresAt,
    "authentication expiry",
  );

  const bindingResult = await pool.query<ApprovalAuthenticationBinding>(
    `SELECT a.envelope_hash, a.policy_id, a.policy_version, a.expires_at, a.nonce,
            agent.owner_id
     FROM approval_requests a
     JOIN operations o ON o.operation_id = a.operation_id
     JOIN agents agent ON agent.agent_id = o.agent_id
     WHERE a.approval_id = $1`,
    [request.approvalId],
  );
  const binding = bindingResult.rows[0];
  if (!binding) {
    throw new ApprovalError(
      "APPROVAL_NOT_FOUND",
      `approval not found: ${request.approvalId}`,
    );
  }
  const persistedExpiry = canonicalTimestamp(
    binding.expires_at,
    "persisted approval expiry",
  );
  if (
    authentication.approverId !== binding.owner_id ||
    authentication.envelopeHash !== binding.envelope_hash ||
    authentication.policyId !== binding.policy_id ||
    authentication.policyVersion !== binding.policy_version ||
    authenticationExpiry !== persistedExpiry ||
    authentication.nonce !== binding.nonce
  ) {
    throw new ApprovalError(
      "APPROVAL_BINDING_MISMATCH",
      "owner authentication does not match the persisted approval binding",
    );
  }

  const keyResult = await pool.query<TrustedOwnerKey>(
    `SELECT algorithm, public_key
     FROM local_owner_approval_keys
     WHERE owner_id = $1 AND key_id = $2 AND status = 'ACTIVE'`,
    [binding.owner_id, authentication.keyId],
  );
  const key = keyResult.rows[0];
  if (!key || key.algorithm !== "ED25519") throw invalidAuthentication();

  let signature: Buffer;
  try {
    signature = Buffer.from(authentication.signature, "base64url");
    if (
      signature.length !== 64 ||
      signature.toString("base64url") !== authentication.signature
    ) {
      throw invalidAuthentication();
    }
    const payload = serializeLocalOwnerApprovalAuthentication({
      approvalId: authentication.approvalId,
      approverId: authentication.approverId,
      keyId: authentication.keyId,
      envelopeHash: authentication.envelopeHash,
      policyId: authentication.policyId,
      policyVersion: authentication.policyVersion,
      expiresAt: authenticationExpiry,
      nonce: authentication.nonce,
    });
    if (!verify(null, payload, createPublicKey(key.public_key), signature)) {
      throw invalidAuthentication();
    }
  } catch (error) {
    if (error instanceof ApprovalError) throw error;
    throw invalidAuthentication();
  }

  // Preserve the existing expiry state transition: an authenticated but expired
  // decision may not approve anything, but the canonical approval primitive is
  // still responsible for atomically expiring the request and held reservation.
  if (Date.parse(now) >= Date.parse(authenticationExpiry)) {
    return approveApprovalAfterAuthentication(pool, {
      approvalId: request.approvalId,
      approverId: authentication.approverId,
      now,
      audit: request.audit,
    });
  }

  const authenticationId = `${request.approvalId}:owner-auth:${authentication.keyId}`;
  await pool.query(
    `INSERT INTO owner_approval_authentications
      (authentication_id, approval_id, owner_id, approver_id, key_id,
       envelope_hash, policy_id, policy_version, expires_at, nonce, signature,
       authenticated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (approval_id) DO NOTHING`,
    [
      authenticationId,
      request.approvalId,
      binding.owner_id,
      authentication.approverId,
      authentication.keyId,
      authentication.envelopeHash,
      authentication.policyId,
      authentication.policyVersion,
      authenticationExpiry,
      authentication.nonce,
      authentication.signature,
      now,
    ],
  );
  const persistedResult = await pool.query<PersistedAuthentication>(
    `SELECT authentication_id, owner_id, approver_id, key_id, envelope_hash,
            policy_id, policy_version, expires_at, nonce, signature, consumed_at
     FROM owner_approval_authentications
     WHERE approval_id = $1`,
    [request.approvalId],
  );
  const persisted = persistedResult.rows[0];
  if (!persisted) throw invalidAuthentication();
  assertAuthenticationMatches(persisted, authenticationId, authentication);

  return approveApprovalAfterAuthentication(pool, {
    approvalId: request.approvalId,
    approverId: authentication.approverId,
    now,
    audit: request.audit,
  });
};
