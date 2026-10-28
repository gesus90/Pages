import { createHash } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";

import { planExecutionNodes } from "./AgentPlanExecutionTargets";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanRemoteChoice } from "@/definition/AgentPlanTarget";
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
                ...(connection.hostKey
                  ? {
                      hostIdentity: createHash("sha256")
                        .update(connection.hostKey.fingerprint)
                        .digest("hex"),
                    }
                  : {}),
                workspaceId: workspace.id,
                workspaceRevision: workspace.revision,
                workspaceName: workspace.name,
                path: workspace.path,
              },
            ]
          : [];
      });
  }

  /**
   * Lists the remote workspaces the person may see as choices of a plan target.
   *
   * @remarks
   * A workspace the person sees but may not run plans on stays in the list
   * with the reason, so the choice explains missing rights; workspaces the
   * person may not see are never listed.
   */
  public async choices(
    userId: string,
  ): Promise<readonly AgentPlanRemoteChoice[]> {
    const [workspaces, scope] = await Promise.all([
      this.workspaces.list(userId),
      this.connections.scope(userId),
    ]);
    return workspaces.map((workspace) => {
      const isConnected = scope.connections.some(
        (entry) => entry.id === workspace.connectionId,
      );
      let reason: string | null = workspace.isUsable ? null : workspace.reason;
      if (!workspace.canOpenConsole || !isConnected) reason = "console_denied";
      return {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        connectionName: workspace.connectionName,
        projectId: workspace.projectId,
        path: workspace.path,
        isUsable: reason === null,
        reason,
      };
    });
  }

  /**
   * Rejects a hidden or reassigned remote target before a plan revision can commit.
   *
   * @remarks
   * The plan's own target is checked like a node's, together with every node
   * that inherits it.
   */
  public async validate(userId: string, plan: AgentPlanInput): Promise<void> {
    const targets = [
      plan.executionTarget,
      ...planExecutionNodes(plan).map((step) => step.executionTarget),
    ].filter((target) => target?.kind === "remote");
    if (targets.length === 0) return;
    const choices = await this.list(userId, plan.projectId ?? "");
    for (const target of targets)
      if (
        target?.kind !== "remote" ||
        !choices.some((choice) => choice.workspaceId === target.workspaceId)
      )
        throw new AgentError("plan_access_denied");
  }
}
