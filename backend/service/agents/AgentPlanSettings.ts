import { writePlanAccess } from "@/backend/database/repositories/agent/AgentPlanAccessRepository";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type {
  AgentPlanTeamService,
  AgentPlanAccessRequest,
} from "./AgentPlanTeamService";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";

/** Explicit settings, separate from ordinary graph saves that never replace access. */
export interface AgentPlanSettingsInput {
  readonly plan: unknown;
  readonly access: AgentPlanAccessRequest;
}

interface SettingsDependencies {
  readonly plans: Pick<AgentPlanRepository, "save">;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly teams: Pick<
    AgentPlanTeamService,
    "validateChange" | "recordAdminAction"
  >;
  readonly revise: (
    userId: string,
    id: string,
    input: unknown,
  ) => Promise<AgentPlan>;
}

/** Commits an edited graph and optional access revision together, after validating both. */
export class AgentPlanSettings {
  private readonly dependencies: SettingsDependencies;

  public constructor(dependencies: SettingsDependencies) {
    this.dependencies = dependencies;
  }

  /** Returns the last committed revision; a refused access change leaves the graph unchanged. */
  public async save(
    userId: string,
    id: string,
    input: AgentPlanSettingsInput,
  ): Promise<number> {
    const previous = await this.dependencies.access.require(userId, id);
    if (input.access.revision !== previous.revision)
      throw new AgentError("plan_conflict");
    const plan = await this.dependencies.revise(userId, id, input.plan);
    const change = await this.dependencies.teams.validateChange(
      { ...previous, projectId: plan.projectId },
      input.access,
    );
    const hasAccessChange =
      change.teams !== undefined || change.ownerId !== undefined;
    await this.dependencies.plans.save(
      plan,
      false,
      hasAccessChange
        ? async (transaction) => {
            await writePlanAccess(transaction, {
              planId: id,
              actorId: userId,
              ...change,
              revision: previous.revision + 1,
            });
          }
        : undefined,
      userId,
    );
    await this.dependencies.teams.recordAdminAction(
      userId,
      previous,
      "admin_saved",
    );
    return previous.revision + (hasAccessChange ? 2 : 1);
  }
}
