import { isApiProvider } from "@/definition/AgentConnection";
import { AGENT_TOOL_IDS } from "@/definition/AgentTools";

import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AgentToolManagerService } from "./AgentToolManagerService";

/** Startup checks reuse the saved connection's login flow without model requests or credential writes. */
export class AgentToolStartupService {
  private readonly dependencies: {
    readonly manager: AgentToolManagerService;
    readonly connections: Pick<AgentConnectionRepository, "list">;
    readonly runtime: Pick<AgentCliRuntime, "check">;
    readonly resources: Pick<AcpResourceScheduler, "snapshot">;
  };

  private starting: Promise<void> | null = null;

  public constructor(dependencies: AgentToolStartupService["dependencies"]) {
    this.dependencies = dependencies;
  }

  /** Runs after existing ACP recovery, conservatively pinning tools for uncertain leftovers. */
  public start(): Promise<void> {
    this.starting ??= this.run();
    return this.starting;
  }

  /** Waits for the startup worker after the manager has cancelled its pending probes. */
  public async shutdown(): Promise<void> {
    await this.starting?.catch(() => undefined);
  }

  private async run(): Promise<void> {
    const { manager, connections, runtime, resources } = this.dependencies;
    for (const lease of resources.snapshot().active)
      manager.supervisor.reserve(lease.instanceId, AGENT_TOOL_IDS);
    const active = (await connections.list()).filter(
      (connection) =>
        connection.isActive && !isApiProvider(connection.provider),
    );
    await manager.start(
      active.flatMap((connection) =>
        isApiProvider(connection.provider) ? [] : [connection.provider],
      ),
    );
    for (const connection of active) {
      if (isApiProvider(connection.provider)) continue;
      try {
        const check = await runtime.check(
          connection,
          "auth",
          AbortSignal.timeout(20_000),
        );
        manager.recordAuthentication(
          connection.id,
          connection.provider,
          check.ok,
        );
      } catch {
        manager.recordAuthentication(connection.id, connection.provider, false);
        console.warn(
          `[pages] CLI connection ${connection.id} could not be checked at startup.`,
        );
      }
    }
  }
}
