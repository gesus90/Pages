import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

import type { McpServerStdio } from "@agentclientprotocol/sdk";
import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";

/** The name of the Pages MCP server in every session. */
export const PAGES_MCP_SERVER = "pages";

/** The environment of an adapter process and the MCP servers of its session. */
export interface AcpLaunch {
  readonly environment: Readonly<Record<string, string>>;
  readonly mcpServers: readonly McpServerStdio[];
  /** Extension data of `session/new`, as the adapter defines it. */
  readonly sessionMeta: Readonly<Record<string, unknown>>;
}

/**
 * The Pages MCP server of one session, or none for a node without MCP access.
 *
 * @param instanceId - The tag every process of the session carries.
 * @param mcp - The local MCP process of the node and how it reaches Pages.
 * @returns The server entry for `session/new`.
 *
 * @remarks
 * The credential travels in the `session/new` request over the input of the
 * adapter, never in an argument list. The instance tag also reaches the MCP
 * process, so the closeout finds it.
 */
export function pagesMcpServers(
  instanceId: string,
  mcp: CliSessionMcp | null,
): readonly McpServerStdio[] {
  if (mcp === null) return [];
  return [
    {
      name: PAGES_MCP_SERVER,
      command: mcp.node,
      args: [mcp.bundle],
      env: [
        { name: "PAGES_URL", value: mcp.url },
        { name: "PAGES_TOKEN", value: mcp.token },
        { name: RUN_INSTANCE_VARIABLE, value: instanceId },
      ],
    },
  ];
}

/**
 * Parses a plain `major.minor.patch` version.
 *
 * @param text - The version an adapter reported.
 * @returns The three numbers, or `null` for a preview or any other spelling.
 */
export function readAdapterVersion(text: string): readonly number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(text);
  return match ? match.slice(1).map(Number) : null;
}
