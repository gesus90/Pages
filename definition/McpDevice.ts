/** Version of the device pairing API, sent in every success answer. */
export const MCP_DEVICE_API_VERSION = "1";

/** How long a started pairing waits for the confirmation in the browser. */
export const MCP_PAIRING_LIFETIME_MS = 10 * 60 * 1000;

/** Seconds a client waits between two result queries. */
export const MCP_PAIRING_INTERVAL_SECONDS = 5;

/** Longest device name a client may send. */
export const MCP_DEVICE_NAME_LIMIT = 100;

/** Longest client version a client may send. */
export const MCP_CLIENT_VERSION_LIMIT = 40;

/** Letters of a user code; no vowels and no look-alikes, so no word and no confusion arises. */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/** Length of a user code without the hyphen. */
export const USER_CODE_LENGTH = 8;

/** Length of the first group of a displayed user code. */
const USER_CODE_GROUP_LENGTH = 4;

/** Error codes of the device API, as the interface names them. */
export type McpDeviceErrorCode =
  | "invalid_request"
  | "slow_down"
  | "authorization_pending"
  | "access_denied"
  | "expired_token"
  | "invalid_grant"
  | "invalid_token"
  | "temporarily_unavailable";

/** Where a pairing request stands, as the page `/koppeln` shows it. */
export type McpPairingState =
  "open" | "paired" | "denied" | "expired" | "invalid" | "missing";

/** The server a machine pairs with, as the page names it. */
export interface McpPairingServer {
  readonly host: string;
  readonly isSecure: boolean;
}

/** What the page `/koppeln` shows; never a secret, a hash or a token. */
export interface McpPairingPageData {
  readonly state: McpPairingState;
  /** The code as displayed (`XXXX-XXXX`), or `null` without a readable code. */
  readonly code: string | null;
  /** The machine name the client sent; `null` unless the state shows it. */
  readonly deviceName: string | null;
  /** Milliseconds an open code stays valid, counted from the answer; `null` in other states. */
  readonly remainingMs: number | null;
  readonly server: McpPairingServer;
  /** Display name of the signed-in account. */
  readonly accountName: string;
}

/** A paired machine as the connections page lists it. */
export interface McpDeviceView {
  readonly id: string;
  readonly name: string;
  readonly clientVersion: string;
  /** ISO timestamp. */
  readonly pairedAt: string;
  /** ISO timestamp, `null` before the first use. */
  readonly lastUsedAt: string | null;
}

/**
 * Reduces typed or pasted user code to its stored form.
 *
 * @param text - Untrusted text such as `bcdf-ghjk`.
 * @returns Eight capital letters without a hyphen, or `null` when the text is no user code.
 */
export function normalizeUserCode(text: unknown): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const code = text.trim().replace("-", "").toUpperCase();

  if (code.length !== USER_CODE_LENGTH) {
    return null;
  }

  return [...code].every((letter) => USER_CODE_ALPHABET.includes(letter))
    ? code
    : null;
}

/**
 * Shows a normalized user code in two groups.
 *
 * @param code - Eight capital letters.
 * @returns The code as `XXXX-XXXX`.
 */
export function formatUserCode(code: string): string {
  return `${code.slice(0, USER_CODE_GROUP_LENGTH)}-${code.slice(USER_CODE_GROUP_LENGTH)}`;
}
