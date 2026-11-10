import path from "node:path";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { SystemMetricsRepository } from "@/backend/database/repositories/SystemMetricsRepository";
import { SystemDashboardService } from "@/backend/service/system/SystemDashboardService";
import { createServerSystemSources } from "@/backend/service/system/SystemSources";

import type { Database } from "@/backend/database/Database";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";

/** The services of the system settings that read the server itself. */
export interface SystemApplicationServices {
  /** Load, drives and facts of the system dashboard (PAGE-282). */
  readonly systemDashboardService: SystemDashboardService;
}

/**
 * Creates the system dashboard on the sources of the running server.
 *
 * @param database - Central database access, for the database size.
 * @param databasePath - Path of the database; its directory is the data directory.
 * @param agents - The ACP occupancy and the agent tools the dashboard counts.
 * @returns The dashboard service; it measures nothing before the first request.
 */
export function createSystemServices(
  database: Database,
  databasePath: string,
  agents: {
    readonly acpResourceScheduler: AcpResourceScheduler;
    readonly agentToolManagerService: AgentToolManagerService;
  },
): SystemApplicationServices {
  const metrics = new SystemMetricsRepository(database);

  return {
    systemDashboardService: new SystemDashboardService({
      sources: createServerSystemSources(),
      dataDirectory: path.dirname(databasePath),
      // The size is read after the request that asked for it may have ended.
      readDatabaseSize: () =>
        withBackgroundDatabaseWork("system_dashboard_database_size", () =>
          metrics.readDatabaseSize(),
        ),
      readAcpOccupancy: async () => {
        const resources = await agents.acpResourceScheduler.inspect();
        return {
          active: resources.active.length,
          maximum: resources.options.maxConcurrentAcpSessions,
        };
      },
      listTools: (actor) => agents.agentToolManagerService.list(actor),
    }),
  };
}
