import { AgentEmployeeRepository } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import { McpDevicePairingRepository } from "@/backend/database/repositories/mcp/McpDevicePairingRepository";
import { McpDeviceRepository } from "@/backend/database/repositories/mcp/McpDeviceRepository";
import { McpDevicePairingService } from "@/backend/service/mcp/McpDevicePairingService";
import { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";

import type { Database } from "@/backend/database/Database";

/** The pairing of machines with the stand-alone Pages MCP program (PAGE-243). */
export interface McpDeviceApplicationServices {
  readonly mcpDevicePairingService: McpDevicePairingService;
  readonly mcpDeviceService: McpDeviceService;
  /** The stored access of agent accounts, so a read-only agent's token only reads (PAGE-301). */
  readonly mcpAgentEmployees: Pick<AgentEmployeeRepository, "find">;
}

/**
 * Creates the services of the machine pairing.
 *
 * @param database - Central database access.
 * @returns The pairing flow and the service for paired machines.
 */
export function createMcpDeviceServices(
  database: Database,
): McpDeviceApplicationServices {
  return {
    mcpDevicePairingService: new McpDevicePairingService(
      new McpDevicePairingRepository(database),
    ),
    mcpDeviceService: new McpDeviceService(new McpDeviceRepository(database)),
    mcpAgentEmployees: new AgentEmployeeRepository(database),
  };
}
