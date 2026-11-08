import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { CliCredentialAccess } from "./CliContracts";
import type { CliGitHubAccess } from "./CliGitHubCredentials";

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
 * servers a chat session brings, such as the credential of Pica's bridge.
 *
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
    ...(input.chat?.mcpServers ?? []).flatMap((server) =>
      "headers" in server ? server.headers.map((header) => header.value) : [],
    ),
  ];
}
