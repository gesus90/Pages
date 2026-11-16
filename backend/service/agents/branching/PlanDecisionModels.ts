import {
  findDecisionModel,
  listDecisionModels,
} from "../../chat/ChatDecisionModels";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentPlanDecision } from "@/definition/AgentPlan";
import type { PageAgentModel } from "@/definition/PageAgent";
import type {
  ChatDecisionSettingsService,
  ResolvedDecisionModel,
} from "../../chat/ChatDecisionSettingsService";

/** Where the decision models of plans are read from. */
export interface PlanDecisionModelsDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  /** The decision model of the instance, the default of every decision without one. */
  readonly settings: Pick<ChatDecisionSettingsService, "resolve">;
  /** Whether the development simulation offers its decision model. */
  readonly isSimulation: boolean;
}

/** The decision model a decision asks now, and whether it is its own. */
export interface PlanDecisionModelChoice extends ResolvedDecisionModel {
  /** `true` for the decision model of the instance. */
  readonly isDefault: boolean;
}

/**
 * The decision models the model decisions of plans may ask.
 * @remarks
 * A decision asks only a decision model of an OpenRouter connection that the
 * person who runs the plan may use, read anew for every activation. A
 * decision without a model of its own asks the decision model of the
 * instance, which no connection scope limits, like the decisions of group
 * chats. Text models are never offered or asked.
 */
export class PlanDecisionModels {
  private readonly dependencies: PlanDecisionModelsDependencies;

  public constructor(dependencies: PlanDecisionModelsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Lists the decision models the person may choose for a decision.
   * @param userId - The person who edits the plan.
   * @returns The listed decision models; empty for an unknown or inactive account.
   */
  public async list(userId: string): Promise<readonly PageAgentModel[]> {
    const viewer = await this.viewer(userId);
    if (viewer === null) return [];
    return listDecisionModels(this.dependencies, viewer);
  }

  /**
   * The name of the decision model of the instance.
   * @returns Its model name, or `null` while none is set or it is no longer listed.
   */
  public async defaultName(): Promise<string | null> {
    const resolved = await this.dependencies.settings.resolve();
    if (resolved === null) return null;
    const model = findDecisionModel(
      await listDecisionModels(this.dependencies, null),
      { ...resolved, reasoningEffort: null },
    );
    return model === null ? null : (model.modelName ?? model.model);
  }

  /** Whether the instance has a usable decision model, the default of decisions without one. */
  public async hasDefault(): Promise<boolean> {
    return (await this.dependencies.settings.resolve()) !== null;
  }

  /**
   * The decision model one activation of a decision asks.
   * @param userId - The person who runs the plan.
   * @param decision - The frozen decision.
   * @returns Its own model when the person may use it and it is listed as a
   * decision model, the model of the instance when it has none, or `null`
   * when neither is usable; a model of its own that is no longer usable never
   * falls back to the instance.
   */
  public async resolve(
    userId: string,
    decision: Pick<AgentPlanDecision, "model">,
  ): Promise<PlanDecisionModelChoice | null> {
    const own = decision.model;
    if (own === undefined) {
      const resolved = await this.dependencies.settings.resolve();
      return resolved === null ? null : { ...resolved, isDefault: true };
    }
    const viewer = await this.viewer(userId);
    if (viewer === null) return null;
    const listed = findDecisionModel(
      await listDecisionModels(this.dependencies, viewer),
      { ...own, reasoningEffort: null },
    );
    return listed === null
      ? null
      : { connectionId: own.connectionId, model: own.model, isDefault: false };
  }

  private async viewer(userId: string): Promise<AgentViewer | null> {
    const [snapshot, groupIds] = await Promise.all([
      this.dependencies.authorization.snapshot(),
      this.dependencies.groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find((entry) => entry.userId === userId);
    return actor?.isActive === true ? { actor, groupIds } : null;
  }
}
