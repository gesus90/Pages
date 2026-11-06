import { AgentError } from "@/backend/error/AgentErrors";
import { correlationEnvironment } from "@/backend/logging/LogCorrelation";
import {
  CORRELATION_ENVIRONMENT_VARIABLE,
  CORRELATION_HEADER,
} from "@/definition/RequestCorrelation";

import type { McpServer, McpCapabilities } from "@agentclientprotocol/sdk";
import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";

/** The name of the Pages MCP server in every session. */
export const PAGES_MCP_SERVER = "pages";

/** The environment of an adapter process and the MCP servers of its session. */
export interface AcpLaunch {
  readonly environment: Readonly<Record<string, string>>;
  readonly mcpServers: readonly McpServer[];
  /** Extension data of `session/new`, as the adapter defines it. */
  readonly sessionMeta: Readonly<Record<string, unknown>>;
}

/** Refuses HTTP/SSE servers unless the actual adapter handshake supports their transport. */
export function requireAcpMcpCapabilities(
  servers: readonly McpServer[],
  capabilities: McpCapabilities | null | undefined,
): void {
  for (const server of servers) {
    if ("type" in server && capabilities?.[server.type] !== true)
      throw new AgentError("plan_mcp_unavailable");
  }
}

/** Where the plan bridge listens, below the address of this Pages instance. */
const PLAN_BRIDGE_PATH = "/api/v1/plan-bridge";

/**
 * The Pages MCP server of one session, or none for a node without MCP access.
 *
 * @param mcp - The step-bound bridge access of the node and how it reaches Pages.
 * @returns The server entry for `session/new`.
 *
 * @remarks
 * The credential travels in the `session/new` request over the input of the
 * adapter, never in an argument list or a process environment. The adapter
 * itself connects to the plan bridge of Pages; no further process starts.
 */
export function pagesMcpServers(
  mcp: CliSessionMcp | null,
): readonly McpServer[] {
  if (mcp === null) return [];
  return [
    {
      type: "http",
      name: PAGES_MCP_SERVER,
      url: `${mcp.url.replace(/\/$/u, "")}${PLAN_BRIDGE_PATH}`,
      headers: [
        { name: "Authorization", value: `Bearer ${mcp.token}` },
        {
          name: CORRELATION_HEADER,
          value: correlationEnvironment()[CORRELATION_ENVIRONMENT_VARIABLE],
        },
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
