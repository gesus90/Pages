import { AgentError } from "@/backend/error/AgentErrors";

import { planExecutionNodes } from "./AgentPlanExecutionTargets";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";

/** Resolves saved SSH workspace choices using the same live access rules as the workspace page. */
export class AgentPlanRemoteTargets {
  private readonly workspaces: RemoteWorkspaceService;
  private readonly connections: RemoteConnectionService;

  public constructor(
    workspaces: RemoteWorkspaceService,
    connections: RemoteConnectionService,
  ) {
    this.workspaces = workspaces;
    this.connections = connections;
  }

  /** Lists authorized metadata only; editing never connects to the remote host. */
  public async list(
    userId: string,
    projectId: string,
  ): Promise<readonly AgentPlanRemoteTarget[]> {
    const [workspaces, scope] = await Promise.all([
      this.workspaces.list(userId),
      this.connections.scope(userId),
    ]);
    return workspaces
      .filter(
        (workspace) =>
          workspace.projectId === projectId && workspace.canOpenConsole,
      )
      .flatMap((workspace) => {
        const connection = scope.connections.find(
          (entry) => entry.id === workspace.connectionId,
        );
        return connection
          ? [
              {
                kind: "remote" as const,
                connectionId: connection.id,
                connectionRevision: connection.revision,
                connectionName: connection.name,
                workspaceId: workspace.id,
                workspaceRevision: workspace.revision,
                workspaceName: workspace.name,
                path: workspace.path,
              },
            ]
          : [];
      });
  }

  /** Rejects a hidden or reassigned remote target before a plan revision can commit. */
  public async validate(userId: string, plan: AgentPlanInput): Promise<void> {
    const steps = planExecutionNodes(plan).filter(
      (step) => step.executionTarget?.kind === "remote",
    );
    if (steps.length === 0) return;
    const choices = await this.list(userId, plan.projectId ?? "");
    for (const step of steps) {
      const target = step.executionTarget;
      if (
        target?.kind !== "remote" ||
        !choices.some((choice) => choice.workspaceId === target.workspaceId)
      )
        throw new AgentError("plan_access_denied");
    }
  }
}
