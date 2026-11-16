import { readsHostMcpConfiguration } from "@/backend/agents/cli/CliHostMcpServers";
import { effectiveAgentAccess } from "@/definition/AgentAccessMode";
import { employeeAccessMode } from "@/definition/AgentEmployee";

import type { McpServer } from "@agentclientprotocol/sdk";
import type { HostMcpDiscovery } from "@/backend/agents/cli/CliHostMcpServers";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  AgentAccessEnvironment,
  AgentEmployeeAccess,
} from "@/definition/AgentEmployee";

/** How long a probe of the host holds before it is repeated. */
const PROBE_MS = 60_000;

/** The exchangeable host facts the access levels depend on. */
export interface AgentAccessEnvironmentDependencies {
  /** Whether the read-only namespace of "Lesend" works on this host. */
  readonly isIsolationAvailable: () => Promise<boolean>;
  /** Whether the service manager starts the worker units every YOLO session needs; absent counts as available. */
  readonly isNativeHostAvailable?: () => Promise<boolean>;
  /** The MCP servers configured on this host for the CLI of a provider. */
  readonly mcp: HostMcpDiscovery;
}

interface Probe {
  readonly result: Promise<boolean>;
  readonly at: number;
}

/**
 * What the host offers an agent beside the Pages tools: whether "Lesend"
 * runs in the read-only namespace, whether YOLO can start natively, and the
 * MCP servers of its CLI.
 * @remarks
 * Everything is read anew, at most once a minute, so installing bubblewrap,
 * enabling the service manager or setting up an MCP server needs no restart
 * and no change of Pages. Tests and the development environment pass their
 * own probes and discovery.
 */
export class AgentAccessEnvironmentService {
  private readonly dependencies: AgentAccessEnvironmentDependencies;
  private isolationProbe: Probe | null = null;
  private nativeProbe: Probe | null = null;

  public constructor(dependencies: AgentAccessEnvironmentDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether the read-only namespace works on this host; probed at most once a minute. */
  public async isIsolationAvailable(): Promise<boolean> {
    this.isolationProbe = this.fresh(this.isolationProbe, () =>
      this.dependencies.isIsolationAvailable(),
    );
    return this.isolationProbe.result;
  }

  /** Whether a YOLO session can confirm its process ownership on this host; probed at most once a minute. */
  public async isNativeHostAvailable(): Promise<boolean> {
    const probe = this.dependencies.isNativeHostAvailable;
    if (!probe) return true;
    this.nativeProbe = this.fresh(this.nativeProbe, probe);
    return this.nativeProbe.result;
  }

  /** What the tab "Zugriff" shows for an agent of this provider; never a command, header or key. */
  public async environment(
    provider: AgentProviderId | null,
  ): Promise<AgentAccessEnvironment> {
    const [isIsolationAvailable, isNativeHostAvailable, servers] =
      await Promise.all([
        this.isIsolationAvailable(),
        this.isNativeHostAvailable(),
        this.dependencies.mcp.servers(provider),
      ]);
    return {
      isIsolationAvailable,
      isNativeHostAvailable,
      mcpServers: servers.map((entry) => entry.summary),
    };
  }

  /**
   * The configured MCP servers a session of the agent receives.
   * @returns Every server of the provider's CLI in YOLO, none in "Lesend",
   * whose calls Pages cannot classify as reading; the same rule as for plan
   * nodes, see `effectiveAgentAccess`.
   */
  public async chatServers(
    provider: AgentProviderId,
    access: AgentEmployeeAccess,
  ): Promise<readonly McpServer[]> {
    const mode = employeeAccessMode(access);
    if (
      mode === null ||
      !effectiveAgentAccess(mode).hostMcpServers ||
      readsHostMcpConfiguration(provider)
    )
      return [];
    const servers = await this.dependencies.mcp.servers(provider);
    return servers.map((entry) => entry.server);
  }

  private fresh(probe: Probe | null, run: () => Promise<boolean>): Probe {
    const now = Date.now();
    if (probe !== null && now - probe.at < PROBE_MS) return probe;
    return { result: run(), at: now };
  }
}
