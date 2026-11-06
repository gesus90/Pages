import {
  agentToolDefinition,
  providerToolIds,
} from "@/backend/service/agents/tools/AgentToolRegistry";

import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type { AgentToolId } from "@/definition/AgentTools";

/** Reconstructs the existing tool removal guard without probing, installing or starting a provider. */
export function pinLocalSessionTools(
  tools: AgentToolManagerService,
  input: {
    readonly instanceId: string;
    readonly provider: AcpProviderId;
    readonly browser: boolean;
  },
): void {
  const required = new Set<AgentToolId>([
    "node",
    "bubblewrap",
    ...providerToolIds(input.provider),
  ]);
  if (input.browser) {
    required.add("playwright_mcp");
    required.add("chromium");
  }
  for (const id of required)
    for (const dependency of agentToolDefinition(id).dependencies)
      required.add(dependency);
  tools.supervisor.reserve(input.instanceId, [...required]);
}
