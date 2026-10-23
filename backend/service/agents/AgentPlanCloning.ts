import { requirePlanRevision } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentError } from "@/backend/error/AgentErrors";

import { clonePlanGraph } from "./AgentPlanClone";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlan, AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanCloneInput } from "./AgentPlanClone";

interface CloningDependencies {
  readonly plans: AgentPlanRepository;
  readonly access: Pick<AgentPlanAccess, "require">;
  /** The facade's normal create validation, including current external resource rights. */
  readonly revise: (
    userId: string,
    input: AgentPlanInput,
  ) => Promise<AgentPlan>;
}

/** Stores one independent graph through normal create validation and the existing operation journal. */
export class AgentPlanCloning {
  private readonly dependencies: CloningDependencies;

  public constructor(dependencies: CloningDependencies) {
    this.dependencies = dependencies;
  }

  /** Commits the source revision check, new saved plan and replay result together without a run. */
  public async clone(
    userId: string,
    sourceId: string,
    input: AgentPlanCloneInput,
    journal?: (
      transaction: DatabaseTransaction,
      planId: string,
    ) => Promise<void>,
  ): Promise<string> {
    const source = await this.dependencies.access.require(userId, sourceId);
    if (source.revision !== input.expectedRevision)
      throw new AgentError("plan_conflict");
    await this.dependencies.plans.requireCloneSource(
      sourceId,
      input.expectedRevision,
    );
    const plan = await this.dependencies.revise(
      userId,
      clonePlanGraph(source, input),
    );
    await this.dependencies.access.require(userId, sourceId);
    await this.dependencies.plans.save(
      plan,
      true,
      async (transaction) => {
        await requirePlanRevision(
          transaction,
          sourceId,
          input.expectedRevision,
        );
        await journal?.(transaction, plan.id);
      },
      userId,
    );
    return plan.id;
  }
}
