import { RemoteError } from "@/backend/error/RemoteErrors";
import { registerLogSecret } from "@/backend/logging/LogRedaction";
import { logCaughtError } from "@/backend/logging/Logger";

import type {
  RemoteConnectionRecord,
  RemoteEncryptedSecrets,
} from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type { SshCredentials } from "@/backend/remote/SshOptions";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { RemoteAuthMethod } from "@/definition/RemoteConnection";

/** The secrets a sign-in method needs, as typed in the dialog. */
export interface RemoteTypedSecrets {
  readonly authMethod: RemoteAuthMethod;
  readonly password: string;
  readonly privateKey: string;
  readonly passphrase: string;
}

type SecretKind = "password" | "private_key" | "passphrase";

/** The existing instance cipher, bound to the connection and the kind of secret. */
export type RemoteSecretCipher = Pick<
  InstanceSecretCipher,
  "encrypt" | "decrypt"
>;

// Binding the kind keeps a stored password from being swapped into the passphrase column.
function binding(connectionId: string, kind: SecretKind): string {
  return `remote-ssh:${connectionId}:${kind}`;
}

function needs(method: RemoteAuthMethod, kind: SecretKind): boolean {
  if (kind === "password") return method === "password";
  if (kind === "private_key") return method !== "password";
  return method === "key_passphrase";
}

function storedOf(
  stored: RemoteEncryptedSecrets | null,
  kind: SecretKind,
): string | null {
  if (!stored) return null;
  if (kind === "password") return stored.password;
  if (kind === "private_key") return stored.privateKey;
  return stored.passphrase;
}

function typedOf(typed: RemoteTypedSecrets, kind: SecretKind): string {
  if (kind === "password") return typed.password;
  if (kind === "private_key") return typed.privateKey;
  return typed.passphrase;
}

function decryptSecret(
  cipher: RemoteSecretCipher,
  connectionId: string,
  kind: SecretKind,
  payload: string | null,
): string | null {
  if (payload === null) return null;
  let secret: string;
  try {
    secret = cipher.decrypt(binding(connectionId, kind), payload);
  } catch (error: unknown) {
    logCaughtError("RemoteConnectionSecrets", error);
    // A payload that no longer decrypts counts as a missing secret, never as its text.
    throw new RemoteError("remote_check_failed", "secret_missing");
  }
  registerLogSecret(secret);
  return secret;
}

/**
 * Encrypts the secrets a connection keeps after a change.
 *
 * @remarks
 * Only the secrets of the chosen method are kept; switching the method
 * deletes the others. An empty typed secret keeps the stored one.
 *
 * @param input - What the dialog sent, the connection and the stored secrets.
 * @param cipher - The instance cipher.
 * @returns The payloads to store.
 * @throws {RemoteError} `remote_secret_required` when the method lacks a secret.
 */
export function encryptRemoteSecrets(
  input: {
    readonly typed: RemoteTypedSecrets;
    readonly connectionId: string;
    readonly stored: RemoteEncryptedSecrets | null;
  },
  cipher: RemoteSecretCipher,
): RemoteEncryptedSecrets {
  const method = input.typed.authMethod;
  function keep(kind: SecretKind): string | null {
    if (!needs(method, kind)) return null;
    const typed = typedOf(input.typed, kind);
    const payload = typed
      ? cipher.encrypt(binding(input.connectionId, kind), typed)
      : storedOf(input.stored, kind);
    if (payload === null) throw new RemoteError("remote_secret_required");
    return payload;
  }
  return {
    password: keep("password"),
    privateKey: keep("private_key"),
    passphrase: keep("passphrase"),
  };
}

/**
 * Decrypts the stored credentials for one SSH operation.
 *
 * @param record - The stored connection.
 * @param cipher - The instance cipher.
 * @returns The credentials; each decrypted secret is also registered for log redaction.
 */
export function decryptRemoteCredentials(
  record: Pick<RemoteConnectionRecord, "id" | "authMethod" | "secrets">,
  cipher: RemoteSecretCipher,
): SshCredentials {
  const { id, secrets } = record;
  return {
    method: record.authMethod,
    password: decryptSecret(cipher, id, "password", secrets.password),
    privateKey: decryptSecret(cipher, id, "private_key", secrets.privateKey),
    passphrase: decryptSecret(cipher, id, "passphrase", secrets.passphrase),
  };
}

/**
 * The credentials of a dialog test: typed secrets first, stored ones for empty fields.
 *
 * @param typed - What the dialog sent.
 * @param stored - The stored connection when an existing one is edited.
 * @param cipher - The instance cipher.
 * @returns The credentials to test with.
 */
export function testRemoteCredentials(
  typed: RemoteTypedSecrets,
  stored: Pick<RemoteConnectionRecord, "id" | "authMethod" | "secrets"> | null,
  cipher: RemoteSecretCipher,
): SshCredentials {
  const saved = stored
    ? decryptRemoteCredentials(stored, cipher)
    : { password: null, privateKey: null, passphrase: null };
  const method = typed.authMethod;
  return {
    method,
    password: needs(method, "password")
      ? typed.password || saved.password
      : null,
    privateKey: needs(method, "private_key")
      ? typed.privateKey || saved.privateKey
      : null,
    passphrase: needs(method, "passphrase")
      ? typed.passphrase || saved.passphrase
      : null,
  };
}
