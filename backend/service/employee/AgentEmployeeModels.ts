import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { modelConsumerRefusal } from "@/definition/AgentModelConsumers";
import { catalogModelChoice } from "@/definition/AgentModelChoice";

import {
  resolveAgentAssignment,
  resolveAgentAssignmentFor,
} from "../agents/AgentAssignmentResolution";
import { connectionModels } from "../agents/AgentConnectionModels";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type {
  AgentEmployeeAccess,
  AgentEmployeeSettings,
} from "@/definition/AgentEmployee";
import type { PageAgentModel } from "@/definition/PageAgent";

/** What the model choice of agents is read from. */
export interface AgentEmployeeModelDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
}

/** How an agent's model appears in a list. */
export interface AgentModelDescription {
  readonly modelName: string;
  readonly provider: string | null;
}

/**
 * The models an agent employee may get and the check of a stored choice
 * (PAGE-266).
 *
 * @remarks
 * The choice lists the models of the shared catalog the administrator may
 * use, including disabled choices. The employee rule requires a chat adapter,
 * a tool-capable model and sufficient access for its tools. Saving checks it on the
 * server, whatever a client sends, and so does every session start.
 */
export class AgentEmployeeModels {
  private readonly dependencies: AgentEmployeeModelDependencies;

  public constructor(dependencies: AgentEmployeeModelDependencies) {
    this.dependencies = dependencies;
  }

  /** Lists the models the person may give an agent. */
  public async models(userId: string): Promise<readonly PageAgentModel[]> {
    return connectionModels(
      this.dependencies.connections,
      await this.viewer(userId),
    );
  }

  /**
   * Checks a choice the person saves for an agent.
   *
   * @throws {AgentEmployeeError} `modelNotAllowed` for a model outside the
   * person's choice or the employee rule.
   */
  public async requireAllowed(
    userId: string,
    settings: AgentEmployeeSettings,
  ): Promise<ResolvedAgentAssignment> {
    let assignment: ResolvedAgentAssignment;
    try {
      assignment = await resolveAgentAssignmentFor(
        this.dependencies.connections,
        await this.viewer(userId),
        settings,
      );
    } catch (error: unknown) {
      if (error instanceof AgentExecutionError)
        throw new AgentEmployeeError("modelNotAllowed");
      throw error;
    }
    await this.requireEmployeeModel(assignment, settings.access);
    return assignment;
  }

  /**
   * Resolves the stored choice of an agent before one of its sessions.
   *
   * @throws {AgentEmployeeError} `unavailable` when the connection or model
   * is gone, `modelNotAllowed` when it no longer passes the employee rule.
   */
  public async resolve(
    settings: AgentEmployeeSettings,
  ): Promise<ResolvedAgentAssignment> {
    let assignment: ResolvedAgentAssignment;
    try {
      assignment = await resolveAgentAssignment(
        this.dependencies.connections,
        settings,
      );
    } catch (error: unknown) {
      if (error instanceof AgentExecutionError)
        throw new AgentEmployeeError("unavailable");
      throw error;
    }
    await this.requireEmployeeModel(assignment, settings.access);
    return assignment;
  }

  /** Names an agent's model and provider for a list, without checking anything. */
  public async describe(
    settings: Pick<AgentEmployeeSettings, "connectionId" | "model">,
  ): Promise<AgentModelDescription> {
    const { connections } = this.dependencies;
    const connection = await connections.find(settings.connectionId);
    if (!connection) return { modelName: settings.model, provider: null };
    const catalog = await connections.catalogs().find(connection.id);
    const model = catalog.models.find((entry) => entry.id === settings.model);
    return {
      modelName: model?.name ?? settings.model,
      provider: connection.provider,
    };
  }

  private async requireEmployeeModel(
    assignment: ResolvedAgentAssignment,
    access: AgentEmployeeAccess,
  ): Promise<void> {
    const catalog = await this.dependencies.connections
      .catalogs()
      .find(assignment.connection.id);
    const model = catalog.models.find((entry) => entry.id === assignment.model);
    const refusal = modelConsumerRefusal(
      "employee",
      model
        ? {
            ...catalogModelChoice(assignment.connection, model),
            isFree: model.isFree,
          }
        : { provider: assignment.connection.provider, model: assignment.model },
      { employeeAccess: access },
    );
    if (refusal !== null) throw new AgentEmployeeError("modelNotAllowed");
  }

  private async viewer(userId: string): Promise<AgentViewer> {
    const [snapshot, groupIds] = await Promise.all([
      this.dependencies.authorization.snapshot(),
      this.dependencies.groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!actor?.isActive) throw new AgentEmployeeError("forbidden");
    return { actor, groupIds };
  }
}
