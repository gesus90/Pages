import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { agentSimulationRunner } from "@/definition/AgentSimulation";
import { AgentError } from "@/backend/error/AgentErrors";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlan } from "@/definition/AgentPlan";

/**
 * Requires every agent connection the plan's steps name, within the write transaction.
 *
 * @throws {AgentError} `plan_context_changed` for a connection that is gone.
 */
export async function requirePlanConnections(
  database: DatabaseTransaction,
  plan: AgentPlan,
): Promise<void> {
  const ids = new Set(
    allPlanSteps(plan).flatMap((node) =>
      node.configuration?.connectionId ? [node.configuration.connectionId] : [],
    ),
  );
  // The simulation's connections are never stored; a node keeps naming them while it is off.
  for (const id of ids) if (agentSimulationRunner(id) !== null) ids.delete(id);
  for (const id of ids) {
    const [connection] = await database.query(
      `
      SELECT id
      FROM agent_connections
      WHERE id = $id;
    `,
      { id },
    );
    if (!connection) throw new AgentError("plan_context_changed");
  }
}

/**
 * Requires the remote workspace and connection of every remote model route, within the write transaction.
 *
 * @throws {AgentError} `plan_context_changed` for a route that no longer fits the plan's project.
 */
export async function requireRemotePlanModels(
  database: DatabaseTransaction,
  plan: AgentPlan,
): Promise<void> {
  for (const node of allPlanSteps(plan)) {
    const route = node.configuration?.runnerRoute;
    if (!route) continue;
    const [workspace] = await database.query(
      `
      SELECT remote_workspaces.id
      FROM remote_workspaces
      INNER JOIN remote_connections
          ON remote_connections.id = remote_workspaces.connection_id
      WHERE remote_workspaces.id = $workspace_id
          AND remote_workspaces.project_id = $project_id
          AND remote_connections.id = $connection_id;
    `,
      {
        workspace_id: route.workspaceId,
        project_id: plan.projectId,
        connection_id: route.connectionId,
      },
    );
    if (!workspace) throw new AgentError("plan_context_changed");
  }
}
