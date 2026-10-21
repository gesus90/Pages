import { createHash } from "node:crypto";

import type { RemoteHostKey } from "@/definition/RemoteConnection";

/**
 * Host key types Pages pins, strongest first, with the algorithms the SSH
 * client may negotiate for each; an RSA key is only used with SHA-2.
 */
const HOST_KEY_ALGORITHMS: ReadonlyMap<string, string> = new Map([
  ["ssh-ed25519", "ssh-ed25519"],
  ["ecdsa-sha2-nistp256", "ecdsa-sha2-nistp256"],
  ["ecdsa-sha2-nistp384", "ecdsa-sha2-nistp384"],
  ["ecdsa-sha2-nistp521", "ecdsa-sha2-nistp521"],
  ["ssh-rsa", "rsa-sha2-512,rsa-sha2-256"],
]);
const PREFERENCE = [...HOST_KEY_ALGORITHMS.keys()];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const MAXIMUM_KEY_LENGTH = 4096;

function fingerprintOf(blob: Buffer): string {
  const digest = createHash("sha256").update(blob).digest("base64");
  return `SHA256:${digest.replace(/=+$/u, "")}`;
}

/** The wire format starts with the algorithm name, so a key cannot claim another type. */
function namesAlgorithm(blob: Buffer, algorithm: string): boolean {
  if (blob.length < 4) return false;
  const length = blob.readUInt32BE(0);
  if (length !== algorithm.length || blob.length < 4 + length) return false;
  return blob.subarray(4, 4 + length).toString("latin1") === algorithm;
}

/**
 * Reads a public host key given as `algorithm base64`.
 *
 * @param line - The key as `ssh-keyscan` prints it, without the host.
 * @returns The key with its SHA-256 fingerprint, or `null` for anything else.
 */
export function parseHostKey(line: string): RemoteHostKey | null {
  const parts = line.trim().split(/\s+/u);
  if (parts.length !== 2) return null;
  const [algorithm, key] = parts;
  if (
    !HOST_KEY_ALGORITHMS.has(algorithm) ||
    key.length > MAXIMUM_KEY_LENGTH ||
    !BASE64.test(key)
  )
    return null;
  const blob = Buffer.from(key, "base64");
  if (!namesAlgorithm(blob, algorithm)) return null;
  return { algorithm, key, fingerprint: fingerprintOf(blob) };
}

/**
 * Picks the strongest supported key from the output of `ssh-keyscan`.
 *
 * @param output - Lines of `host algorithm base64`; comments are ignored.
 * @returns The preferred key, or `null` when the machine offered none.
 */
export function preferredHostKey(output: string): RemoteHostKey | null {
  const keys = output
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => parseHostKey(line.trim().split(/\s+/u).slice(1).join(" ")))
    .filter((key): key is RemoteHostKey => key !== null);
  keys.sort(
    (left, right) =>
      PREFERENCE.indexOf(left.algorithm) - PREFERENCE.indexOf(right.algorithm),
  );
  return keys.at(0) ?? null;
}

/** Returns whether two keys are the same key. */
export function isSameHostKey(
  left: RemoteHostKey,
  right: RemoteHostKey,
): boolean {
  return left.algorithm === right.algorithm && left.key === right.key;
}

/** The algorithms the client may negotiate, so only the pinned key can match. */
export function hostKeyAlgorithms(hostKey: RemoteHostKey): string {
  return HOST_KEY_ALGORITHMS.get(hostKey.algorithm) ?? hostKey.algorithm;
}

/** The pinned key as the only line of a private `known_hosts` file. */
export function knownHostsLine(alias: string, hostKey: RemoteHostKey): string {
  return `${alias} ${hostKey.algorithm} ${hostKey.key}\n`;
}
