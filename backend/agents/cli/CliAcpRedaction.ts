import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { CliCredentialAccess } from "./CliContracts";
import type { CliGitHubAccess } from "./CliGitHubCredentials";

/** Environment values shorter than this are switches, not keys. */
const MINIMUM_SECRET_LENGTH = 8;

/** Masks the credentials carried by one ACP session before it records any text. */
export function createAcpRedactor(input: {
  readonly credentials?: CliCredentialAccess;
  readonly github: CliGitHubAccess | null;
  readonly tokens: readonly (string | undefined)[];
}): (text: string) => string {
  return (text) => {
    const withoutKey = input.credentials?.redact(text) ?? text;
    let masked = input.github?.redact(withoutKey) ?? withoutKey;
    for (const secret of input.tokens) {
      if (secret) masked = masked.replaceAll(secret, "[redacted]");
    }
    return masked;
  };
}

/**
 * The tokens one ACP session carries: the step credential of its Pages MCP
 * server, the OpenCode server password and the header values of the MCP
 * servers a chat session brings, such as the credential of Pica's bridge, and
 * the longer environment values of the configured MCP servers of a chat.
 * @param input - The session input.
 * @param launch - The planned launch of the adapter.
 * @returns The values to mask; absent ones stay `undefined`.
 */
export function acpSessionSecrets(
  input: AgentPlanSessionInput,
  launch: AcpLaunch,
): readonly (string | undefined)[] {
  return [
    input.mcp?.token,
    launch.environment.OPENCODE_SERVER_PASSWORD,
    ...(input.chat?.mcpServers ?? []).flatMap((server) => {
      if ("headers" in server)
        return server.headers.map((header) => header.value);
      // The environment of a configured MCP server may hold its key;
      // short values such as "1" are switches, never a key, and stay readable.
      return "env" in server
        ? server.env
            .map((variable) => variable.value)
            .filter((value) => value.length >= MINIMUM_SECRET_LENGTH)
        : [];
    }),
  ];
}

function redactJsonText(
  input: unknown,
  redact: (text: string) => string,
): unknown {
  if (typeof input === "string") return redact(input);
  if (Array.isArray(input))
    return input.map((entry: unknown) => redactJsonText(entry, redact));
  if (input !== null && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input).map(([key, entry]: [string, unknown]) => [
        key,
        redactJsonText(entry, redact),
      ]),
    );
  return input;
}

/** Redacts parsed ACP text without allowing a credential pattern to consume JSON quotes or framing. */
export function redactAcpJsonLine(
  line: string,
  redact: (text: string) => string,
): string {
  try {
    const parsed: unknown = JSON.parse(line);
    return JSON.stringify(redactJsonText(parsed, redact));
  } catch {
    return redact(line);
  }
}
