import { lstat } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { CliHome } from "./CliContracts";

/** A connection holds one key for one native OpenCode model provider. */
export interface OpenCodeKeyInput {
  readonly modelProvider: string;
  readonly apiKey: string;
}

/**
 * The keys of API connections in Pages that OpenCode receives automatically.
 *
 * @remarks
 * Each key stays stored once, with its API connection; it is read for the
 * moment of a status, catalog or run and passed on only to the child process.
 */
export interface OpenCodeLinkedKeys {
  read(): Promise<readonly OpenCodeKeyInput[]>;
}

/** Narrows the native API credential format before it can reach OpenCode. */
export function readOpenCodeKey(content: string): OpenCodeKeyInput {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new AgentError("cli_not_logged_in");
    const entries: [string, unknown][] = Object.entries(parsed);
    const [provider, credential] = entries[0] ?? [];
    if (
      entries.length !== 1 ||
      !isOpenCodeModelProvider(provider) ||
      typeof credential !== "object" ||
      credential === null ||
      Reflect.get(credential, "type") !== "api"
    )
      throw new AgentError("cli_not_logged_in");
    const apiKey: unknown = Reflect.get(credential, "key");
    if (
      typeof apiKey !== "string" ||
      !apiKey ||
      apiKey.length > 512 ||
      /[\s\p{Cc}]/u.test(apiKey)
    )
      throw new AgentError("cli_not_logged_in");
    return { modelProvider: provider, apiKey };
  } catch (caughtError: unknown) {
    logCaughtError("OpenCodeCredentials", caughtError);

    throw new AgentError("cli_not_logged_in");
  }
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
