import type {
  RemoteConnectionView,
  RemoteHostKey,
} from "@/definition/RemoteConnection";
import type { RemoteConnectionDraft } from "./use-remote-connection-form";

const ALGORITHM_LABELS: Readonly<Record<string, string>> = {
  "ssh-ed25519": "ED25519",
  "ecdsa-sha2-nistp256": "ECDSA-256",
  "ecdsa-sha2-nistp384": "ECDSA-384",
  "ecdsa-sha2-nistp521": "ECDSA-521",
  "ssh-rsa": "RSA",
};

/** The key type as `ssh-keygen -l` names it, so a person can compare it on the machine. */
export function hostKeyLabel(hostKey: RemoteHostKey): string {
  return Object.hasOwn(ALGORITHM_LABELS, hostKey.algorithm)
    ? ALGORITHM_LABELS[hostKey.algorithm]
    : hostKey.algorithm;
}

/**
 * The pinned key the dialog keeps when it is saved.
 *
 * @remarks
 * Mirrors the server: a key confirmed in the dialog wins, and a new host or
 * port drops the stored key.
 *
 * @param connection - The edited connection, or `null`.
 * @param draft - The dialog's current values.
 * @param confirmed - The key confirmed in this dialog.
 * @returns The key, and whether the stored one no longer applies.
 */
export function effectiveHostKey(
  connection: RemoteConnectionView | null,
  draft: RemoteConnectionDraft,
  confirmed: RemoteHostKey | null,
): { readonly hostKey: RemoteHostKey | null; readonly isDropped: boolean } {
  if (confirmed) return { hostKey: confirmed, isDropped: false };
  if (!connection?.hostKey) return { hostKey: null, isDropped: false };
  const isSameEndpoint =
    connection.host.toLowerCase() === draft.host.trim().toLowerCase() &&
    String(connection.port) === draft.port.trim();
  return isSameEndpoint
    ? { hostKey: connection.hostKey, isDropped: false }
    : { hostKey: null, isDropped: true };
}
