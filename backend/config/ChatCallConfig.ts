import path from "node:path";

import type { TomlTable } from "smol-toml";

/** The table of `config.toml` that holds the audio calls of the chat. */
export const CHAT_CALLS_KEY = "chatCalls";

/** The shortest and the longest time a TURN credential stays valid, in seconds. */
export const CHAT_CALL_CREDENTIAL_SECONDS = {
  minimum: 60,
  maximum: 86_400,
  default: 3_600,
} as const;

/**
 * How the browsers of an audio call find each other: STUN and TURN servers.
 * @example
 * ```toml
 * [chatCalls]
 * stunUrls = ["stun:turn.example.org:3478"]
 * turnUrls = ["turn:turn.example.org:3478?transport=udp", "turns:turn.example.org:5349?transport=tcp"]
 * turnSecretFile = "/etc/pages/turn-secret"
 * turnCredentialSeconds = 3600
 * relayOnly = false
 * ```
 */
export interface ChatCallSetting {
  /** `stun:` or `stuns:` addresses; missing: the browsers use their own addresses only. */
  readonly stunUrls?: readonly string[];
  /** `turn:` or `turns:` addresses of a coturn server that runs with `use-auth-secret`. */
  readonly turnUrls?: readonly string[];
  /** Absolute path of the file with the `static-auth-secret` of coturn; required with `turnUrls`. */
  readonly turnSecretFile?: string;
  /** How long a TURN credential stays valid, 60 to 86400 seconds; missing: 3600. */
  readonly turnCredentialSeconds?: number;
  /** Forces every call over the TURN relay, for a check of the relay path; missing: off. */
  readonly relayOnly?: boolean;
}

function isTable(input: unknown): input is TomlTable {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    !(input instanceof Date)
  );
}

function readUrls(
  table: TomlTable,
  key: "stunUrls" | "turnUrls",
  schemes: readonly string[],
): readonly string[] | undefined {
  const urls = table[key];
  if (urls === undefined) return undefined;
  const isValid =
    Array.isArray(urls) &&
    urls.every(
      (url) =>
        typeof url === "string" &&
        schemes.some((scheme) => url.startsWith(`${scheme}:`)) &&
        !url.includes("@"),
    );
  if (!isValid)
    throw new Error(
      `"${CHAT_CALLS_KEY}.${key}" must be a list of ${schemes.join(" or ")} addresses without credentials.`,
    );
  return urls.map(String);
}

function readSecretFile(table: TomlTable): string | undefined {
  const file = table.turnSecretFile;
  if (file === undefined) return undefined;
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw new Error(
      `"${CHAT_CALLS_KEY}.turnSecretFile" must be an absolute file path.`,
    );
  return path.normalize(file);
}

function readSeconds(table: TomlTable): number | undefined {
  const seconds = table.turnCredentialSeconds;
  if (seconds === undefined) return undefined;
  if (
    typeof seconds !== "number" ||
    !Number.isInteger(seconds) ||
    seconds < CHAT_CALL_CREDENTIAL_SECONDS.minimum ||
    seconds > CHAT_CALL_CREDENTIAL_SECONDS.maximum
  )
    throw new Error(
      `"${CHAT_CALLS_KEY}.turnCredentialSeconds" must be a whole number from ${CHAT_CALL_CREDENTIAL_SECONDS.minimum} to ${CHAT_CALL_CREDENTIAL_SECONDS.maximum}.`,
    );
  return seconds;
}

function readRelayOnly(table: TomlTable): boolean | undefined {
  const { relayOnly } = table;
  if (relayOnly === undefined) return undefined;
  if (typeof relayOnly !== "boolean")
    throw new Error(`"${CHAT_CALLS_KEY}.relayOnly" must be true or false.`);
  return relayOnly;
}

/**
 * Reads the audio calls from a parsed configuration file.
 * @param document - Parsed TOML document.
 * @returns The setting, or nothing when the file names none.
 * @throws {Error} When a value of the table is malformed or TURN addresses
 * come without the secret file; the message never quotes a value.
 */
export function readChatCallConfig(document: TomlTable): {
  readonly chatCalls?: ChatCallSetting;
} {
  const table = document[CHAT_CALLS_KEY];
  if (table === undefined) return {};
  if (!isTable(table)) throw new Error(`"${CHAT_CALLS_KEY}" must be a table.`);
  const stunUrls = readUrls(table, "stunUrls", ["stun", "stuns"]);
  const turnUrls = readUrls(table, "turnUrls", ["turn", "turns"]);
  const turnSecretFile = readSecretFile(table);
  const turnCredentialSeconds = readSeconds(table);
  const relayOnly = readRelayOnly(table);
  if (turnUrls !== undefined && turnUrls.length > 0 && !turnSecretFile)
    throw new Error(
      `"${CHAT_CALLS_KEY}.turnUrls" needs "${CHAT_CALLS_KEY}.turnSecretFile".`,
    );
  return {
    chatCalls: {
      ...(stunUrls === undefined ? {} : { stunUrls }),
      ...(turnUrls === undefined ? {} : { turnUrls }),
      ...(turnSecretFile === undefined ? {} : { turnSecretFile }),
      ...(turnCredentialSeconds === undefined ? {} : { turnCredentialSeconds }),
      ...(relayOnly === undefined ? {} : { relayOnly }),
    },
  };
}
