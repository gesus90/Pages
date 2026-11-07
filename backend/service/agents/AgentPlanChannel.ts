import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { PlanDependencies } from "./AgentPlanDependencies";

/**
 * Binds the workspace access of the plan service to another surface.
 *
 * @param dependencies - The dependencies of the plan service of the interface.
 * @param channel - The surface the plans are read and changed for.
 * @returns The same storage, rules, runs and engine; only the workspace
 * access reads the administrator role for that surface.
 *
 * @remarks
 * A plan is visible while its workspace is, so the channel of the workspace
 * access decides the administrator reading of plans as well: MCP counts a
 * personal administrator regardless of the role mode of the browser, the
 * interface does not (PAGE-246).
 */
export function planDependenciesForChannel(
  dependencies: PlanDependencies,
  channel: ActorChannel,
): PlanDependencies {
  return {
    ...dependencies,
    workspaces: dependencies.workspaces.forChannel(channel),
    workspaceCatalog: dependencies.workspaceCatalog?.forChannel(channel),
    access: dependencies.access.forChannel(channel),
  };
}
