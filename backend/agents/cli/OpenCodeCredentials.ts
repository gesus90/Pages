import { constants } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import type { CliHome } from "./CliContracts";

/** A connection holds one key for one native OpenCode model provider. */
export interface OpenCodeKeyInput {
  readonly modelProvider: string;
  readonly apiKey: string;
}

/** OpenCode's credential file inside the connection's isolated data directory. */
export function openCodeCredentialFile(home: CliHome): string {
  return path.join(home.config, "opencode", "auth.json");
}

/** Validates a native provider ID, never a URL, file path or model alias. */
export function isOpenCodeModelProvider(input: unknown): input is string {
  return typeof input === "string" && /^[a-z0-9][a-z0-9_-]{0,99}$/u.test(input);
}

/** Refuses a credential directory redirected outside this connection. */
export async function requireOpenCodeCredentialDirectory(
  home: CliHome,
): Promise<void> {
  const facts = await lstat(path.dirname(openCodeCredentialFile(home)));
  const owner = process.getuid?.();
  if (
    !facts.isDirectory() ||
    facts.isSymbolicLink() ||
    (owner !== undefined && facts.uid !== owner)
  )
    throw new AgentError("cli_not_logged_in");
}

/**
 * Returns only the provider ID of the connection, never its credential.
 *
 * @remarks
 * Existing OpenRouter connections already have this same native file and
 * need no default or migration. Multiple providers, remote configuration and
 * other authentication formats are refused instead of choosing one.
 */
export async function readOpenCodeModelProvider(
  home: CliHome,
): Promise<string> {
  try {
    await requireOpenCodeCredentialDirectory(home);
    const parsed: unknown = JSON.parse(
      await readFile(openCodeCredentialFile(home), {
        encoding: "utf8",
        flag: constants.O_RDONLY | constants.O_NOFOLLOW,
      }),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new AgentError("cli_not_logged_in");
    const entries: [string, unknown][] = Object.entries(parsed);
    const [provider, credential] = entries[0] ?? [];
    if (
      entries.length !== 1 ||
      !isOpenCodeModelProvider(provider) ||
      typeof credential !== "object" ||
      credential === null ||
      Reflect.get(credential, "type") !== "api" ||
      typeof Reflect.get(credential, "key") !== "string" ||
      !Reflect.get(credential, "key")
    )
      throw new AgentError("cli_not_logged_in");
    return provider;
  } catch {
    // Neither parser errors nor credential content cross this boundary.
    throw new AgentError("cli_not_logged_in");
  }
}
