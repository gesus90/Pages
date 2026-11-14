import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { canRunPlan } from "@/definition/AgentPlanTeam";
import { withoutTicketFlow } from "@/definition/AgentPlanGraph";

import { executePlanStart } from "./AgentPlanStartRejections";

import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";
import type { AgentPlanPreparation } from "./AgentPlanPreparation";
import type { AgentPlanRunEngine } from "./AgentPlanRunEngine";
import type { AgentPlanStartOwner } from "@/definition/AgentPlanResourceRelease";
import type { AgentPlanStartResources } from "./AgentPlanStartResources";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

interface StartDependencies {
  readonly startResources?: Pick<AgentPlanStartResources, "owners">;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly preparation: Pick<AgentPlanPreparation, "prepare">;
  readonly engine: Pick<AgentPlanRunEngine, "start">;
  readonly plans: Pick<AgentPlanRepository, "save">;
  readonly startRejections?: Pick<AgentPlanStartRejectionRepository, "append">;
  readonly revise: (
    userId: string,
    id: string,
    input: unknown,
  ) => Promise<AgentPlan>;
}

/** Starts only the selected revision and records supported pre-run refusals. */
export class AgentPlanStartActions {
  private readonly dependencies: StartDependencies;

  public constructor(dependencies: StartDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads current affected owners without preventing the existing reset of an invalid saved plan. */
  public async owners(
    userId: string,
    id: string,
    revision: number,
  ): Promise<readonly AgentPlanStartOwner[]> {
    const plan = await this.dependencies.access.require(userId, id);
    if (!canRunPlan(plan)) throw new AgentError("plan_access_denied");
    if (plan.revision !== revision) throw new AgentError("plan_conflict");
    let snapshot: AgentPlanSnapshot;
    try {
      snapshot = await this.dependencies.preparation.prepare(userId, plan);
    } catch (error: unknown) {
      // Restart can still record its reset when validation refuses dispatch.
      if (error instanceof AgentError || error instanceof AgentExecutionError)
        return [];
      throw error;
    }
    return (await this.dependencies.startResources?.owners(snapshot)) ?? [];
  }

  /** Starts the currently saved revision after checking the executor's rights. */
  public async play(
    userId: string,
    id: string,
    revision: number,
    journal?: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    const plan = await this.dependencies.access.require(userId, id);
    if (!canRunPlan(plan)) throw new AgentError("plan_access_denied");
    if (plan.revision !== revision) throw new AgentError("plan_conflict");
    return executePlanStart(
      this.dependencies,
      {
        userId,
        planId: id,
        planRevision: revision,
        action: "play",
        journal: journal?.recordStartRejection,
      },
      () => this.dependencies.preparation.prepare(userId, plan),
      async (snapshot) => {
        await this.dependencies.access.require(userId, id);
        return this.dependencies.engine.start(
          userId,
          snapshot,
          undefined,
          journal,
        );
      },
    );
  }

  /** Saves and starts one draft atomically; a refused start leaves the draft unsaved. */
  public async saveAndPlay(
    userId: string,
    id: string,
    input: unknown,
  ): Promise<AgentPlanRun> {
    if (!canRunPlan(await this.dependencies.access.require(userId, id)))
      throw new AgentError("plan_access_denied");
    const plan = await this.dependencies.revise(userId, id, input);
    return executePlanStart(
      this.dependencies,
      {
        userId,
        planId: id,
        planRevision: plan.revision + 1,
        action: "save_and_play",
      },
      () =>
        this.dependencies.preparation.prepare(
          userId,
          withoutTicketFlow({ ...plan, revision: plan.revision + 1 }),
        ),
      async (snapshot) => {
        await this.dependencies.access.require(userId, id);
        return this.dependencies.engine.start(userId, snapshot, (create) =>
          this.dependencies.plans.save(plan, false, create, userId),
        );
      },
    );
  }
}
