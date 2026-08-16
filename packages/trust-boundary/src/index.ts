import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export type ComponentRole = "ADAPTER" | "RECONCILER";

export interface ComponentCredentialMaterial {
  credentialId: string;
  componentId: string;
  role: ComponentRole;
  publicKey: string;
  privateKey: string;
}

export interface ComponentAuthorization {
  credentialId: string;
  componentId: string;
  role: ComponentRole;
  signature: string;
}

const AUTH_DOMAIN = "crip/component-auth/v1\u0000";

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
};

const canonicalize = (value: unknown): string =>
  JSON.stringify(sortValue(value));

const keyFromBase64 = (value: string, type: "pkcs8" | "spki"): KeyObject =>
  type === "pkcs8"
    ? createPrivateKey({
        key: Buffer.from(value, "base64url"),
        format: "der",
        type: "pkcs8",
      })
    : createPublicKey({
        key: Buffer.from(value, "base64url"),
        format: "der",
        type: "spki",
      });

export const canonicalComponentAuthPayload = (
  action: string,
  authorization: Pick<
    ComponentAuthorization,
    "credentialId" | "componentId" | "role"
  >,
  payload: Record<string, unknown>,
): string =>
  canonicalize({
    domain: AUTH_DOMAIN,
    version: 1,
    action,
    credentialId: authorization.credentialId,
    componentId: authorization.componentId,
    role: authorization.role,
    payload,
  });

export const componentAuthPayloadHash = (
  action: string,
  authorization: Pick<
    ComponentAuthorization,
    "credentialId" | "componentId" | "role"
  >,
  payload: Record<string, unknown>,
): string =>
  `sha256:${createHash("sha256")
    .update(
      canonicalComponentAuthPayload(action, authorization, payload),
      "utf8",
    )
    .digest("hex")}`;

export const generateComponentCredential = (input: {
  credentialId: string;
  componentId: string;
  role: ComponentRole;
}): ComponentCredentialMaterial => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    ...input,
    publicKey: publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    privateKey: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
  };
};

export const signComponentAction = (
  credential: Pick<
    ComponentCredentialMaterial,
    "credentialId" | "componentId" | "role" | "privateKey"
  >,
  action: string,
  payload: Record<string, unknown>,
): ComponentAuthorization => {
  const identity = {
    credentialId: credential.credentialId,
    componentId: credential.componentId,
    role: credential.role,
  } as const;
  const signature = sign(
    null,
    Buffer.from(
      canonicalComponentAuthPayload(action, identity, payload),
      "utf8",
    ),
    keyFromBase64(credential.privateKey, "pkcs8"),
  ).toString("base64url");
  return { ...identity, signature };
};

export const verifyComponentAction = (
  authorization: ComponentAuthorization,
  publicKey: string,
  action: string,
  payload: Record<string, unknown>,
): boolean => {
  if (!/^[A-Za-z0-9._:-]+$/.test(authorization.credentialId)) return false;
  if (!/^[A-Za-z0-9._:-]+$/.test(authorization.componentId)) return false;
  if (!/^(ADAPTER|RECONCILER)$/.test(authorization.role)) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(authorization.signature)) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(publicKey)) return false;
  return verify(
    null,
    Buffer.from(
      canonicalComponentAuthPayload(action, authorization, payload),
      "utf8",
    ),
    keyFromBase64(publicKey, "spki"),
    Buffer.from(authorization.signature, "base64url"),
  );
};
