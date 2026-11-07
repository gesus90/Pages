import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { USER_CODE_ALPHABET, USER_CODE_LENGTH } from "@/definition/McpDevice";

/** What a hashed value stands for; the same text hashes differently for each purpose. */
export type McpDeviceHashPurpose =
  "user-code" | "device-secret" | "token" | "address";

/** Characters of a secret or token: 32 random bytes in base64url. */
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * Draws a new user code.
 *
 * @returns Eight capital letters without a hyphen, each drawn without bias.
 */
export function createUserCode(): string {
  return Array.from({ length: USER_CODE_LENGTH }, () =>
    USER_CODE_ALPHABET.charAt(randomInt(USER_CODE_ALPHABET.length)),
  ).join("");
}

/**
 * Tells whether a text has the shape of a device secret or token.
 *
 * @param text - Untrusted text.
 * @returns Whether it holds 43 characters of base64url.
 */
export function isMcpDeviceCredential(text: unknown): text is string {
  return typeof text === "string" && CREDENTIAL_PATTERN.test(text);
}

/**
 * Produces the only stored form of a user code, device secret, token or address.
 *
 * @param purpose - What the value is, so equal texts of different purposes differ.
 * @param value - The clear text.
 * @returns A SHA-256 digest in hexadecimal.
 */
export function hashMcpDeviceValue(
  purpose: McpDeviceHashPurpose,
  value: string,
): string {
  return createHash("sha256")
    .update(`mcp-device:${purpose}:${value}`)
    .digest("hex");
}

/**
 * Compares two stored hashes without leaking where they differ.
 *
 * @param first - A hash from {@link hashMcpDeviceValue}.
 * @param second - Another hash from {@link hashMcpDeviceValue}.
 * @returns Whether both are the same.
 */
export function equalMcpDeviceHashes(first: string, second: string): boolean {
  const firstBytes = Buffer.from(first, "hex");
  const secondBytes = Buffer.from(second, "hex");
  return (
    firstBytes.length === secondBytes.length &&
    timingSafeEqual(firstBytes, secondBytes)
  );
}
