import { hasHostTools } from "@/definition/AgentEmployee";

import type { McpServer } from "@agentclientprotocol/sdk";
import type { HostMcpDiscovery } from "@/backend/agents/cli/CliHostMcpServers";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  AgentAccessEnvironment,
  AgentEmployeeAccess,
} from "@/definition/AgentEmployee";

/** How long a probe of the isolation holds before it is repeated. */
const ISOLATION_PROBE_MS = 60_000;

/** The exchangeable host facts the access levels depend on. */
export interface AgentAccessEnvironmentDependencies {
  /** Whether the bubblewrap isolation of the CLI runs works on this host. */
  readonly isIsolationAvailable: () => Promise<boolean>;
  /** The MCP servers configured on this host for the CLI of a provider. */
  readonly mcp: HostMcpDiscovery;
}

/**
 * What the host offers an agent beside the Pages tools (PAGE-303): whether
 * "Arbeitsplatz" can run isolated, and the MCP servers of its CLI.
 *
 * @remarks
 * Both are read anew on every request, so installing bubblewrap or setting up
 * an MCP server needs no restart and no change of Pages. Tests and the
 * development environment pass their own isolation probe and discovery.
 */
export class AgentAccessEnvironmentService {
  private readonly dependencies: AgentAccessEnvironmentDependencies;
  private probe: {
    readonly result: Promise<boolean>;
    readonly at: number;
  } | null = null;

  public constructor(dependencies: AgentAccessEnvironmentDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether "Arbeitsplatz" can be chosen and started on this host; probed at most once a minute. */
  public async isIsolationAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.probe === null || now - this.probe.at >= ISOLATION_PROBE_MS)
      this.probe = {
        result: this.dependencies.isIsolationAvailable(),
        at: now,
      };
    return this.probe.result;
  }

  /** What the tab "Zugriff" shows for an agent of this provider; never a command, header or key. */
  public async environment(
    provider: AgentProviderId | null,
  ): Promise<AgentAccessEnvironment> {
    const [isIsolationAvailable, servers] = await Promise.all([
      this.isIsolationAvailable(),
      this.dependencies.mcp.servers(provider),
    ]);
    return {
      isIsolationAvailable,
      mcpServers: servers.map((entry) => entry.summary),
    };
  }

  /**
   * The configured MCP servers a chat of the agent receives.
   *
   * @returns None in "Nur Pages"; otherwise every server of the provider's CLI.
   */
  public async chatServers(
    provider: AgentProviderId,
    access: AgentEmployeeAccess,
  ): Promise<readonly McpServer[]> {
    if (!hasHostTools(access)) return [];
    const servers = await this.dependencies.mcp.servers(provider);
    return servers.map((entry) => entry.server);
  }
}
