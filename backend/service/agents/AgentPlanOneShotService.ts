import { ONE_SHOT_DELETION_DELAY_MS } from "@/definition/AgentPlanOneShot";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import type {
  AgentPlanOneShotRepository,
  OneShotPlanCandidate,
} from "@/backend/database/repositories/agent/AgentPlanOneShotRepository";

/**
 * A step that runs before a one-time plan is deleted.
 *
 * @remarks
 * The deletion keeps no final report of its own. A later automation hands one
 * over to a person or an agent by adding a hook here; a hook that throws
 * keeps the plan and the deletion is tried again.
 */
export interface OneShotBeforeDeletionHook {
  beforeDelete(plan: OneShotPlanCandidate): Promise<void>;
}

/** What the deletion of one-time plans is built from; time and runs can be replaced. */
export interface AgentPlanOneShotDependencies {
  readonly repository: Pick<
    AgentPlanOneShotRepository,
    "schedule" | "cancel" | "listDue" | "findCandidate" | "deletePlan"
  >;
  /** Removes every run of the plan with its files; `false` while one has not settled. */
  readonly purgeRuns: (planId: string) => Promise<boolean>;
  readonly now: () => Date;
  readonly hooks?: readonly OneShotBeforeDeletionHook[];
}

/** How one attempt at a due deletion ended. */
export type OneShotDeletionOutcome =
  "deleted" | "waiting" | "kept" | "not_due" | "failed";

/**
 * Schedules and carries out the deletion of one-time plans after a successful run (PAGE-309).
 *
 * @remarks
 * A run that ends as `succeeded` sets a deadline five minutes ahead; any other
 * end leaves the plan alone. The deadline is stored with the plan, so a
 * restart carries out what fell due meanwhile. A new run, "keep" or removing
 * the mark cancels it. Only what the runs of the plan recorded is deleted:
 * their rows, the transcript homes and journals those rows name, and the
 * plan itself. Commits, branches, tickets, wiki pages, attachments and shared
 * workspaces, agents, templates and parameters are never touched.
 */
export class AgentPlanOneShotService {
  private readonly dependencies: AgentPlanOneShotDependencies;

  public constructor(dependencies: AgentPlanOneShotDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Sets the deadline for the plan of a run that just ended as `succeeded`.
   *
   * @param planId - The plan of the run.
   * @returns Whether the plan is a one-time plan and now waits for its deletion.
   */
  public async scheduleAfterSuccess(planId: string): Promise<boolean> {
    const deletionAt = new Date(
      this.dependencies.now().getTime() + ONE_SHOT_DELETION_DELAY_MS,
    ).toISOString();
    return this.dependencies.repository.schedule(planId, deletionAt);
  }

  /** Cancels a scheduled deletion, for example because a new run started. */
  public async cancel(planId: string): Promise<void> {
    await this.dependencies.repository.cancel(planId);
  }

  /**
   * Carries out every deletion that is due.
   *
   * @returns The plans that are gone.
   *
   * @remarks
   * One failing plan is logged and tried again at the next call; the others
   * still go.
   */
  public async deleteDue(): Promise<readonly string[]> {
    const due = await this.dependencies.repository.listDue(
      this.dependencies.now().toISOString(),
    );
    const deleted: string[] = [];
    for (const planId of due)
      if ((await this.deleteIfDue(planId)) === "deleted") deleted.push(planId);
    return deleted;
  }

  /** Carries out the deletion of one plan if its deadline passed and nothing changed since. */
  public async deleteIfDue(planId: string): Promise<OneShotDeletionOutcome> {
    try {
      return await this.attempt(planId);
    } catch (error: unknown) {
      logCaughtError("AgentPlanOneShotService", error);
      return "failed";
    }
  }

  private async attempt(planId: string): Promise<OneShotDeletionOutcome> {
    const { repository, purgeRuns, hooks = [] } = this.dependencies;
    const plan = await repository.findCandidate(planId);
    if (!plan) return "not_due";
    if (!plan.isOneShot || plan.deletionAt === null) return "kept";
    if (plan.deletionAt > this.dependencies.now().toISOString())
      return "not_due";
    // A run that started or ended otherwise since the deadline was set keeps the plan.
    if (plan.hasActiveRun || plan.latestRunStatus !== "succeeded") {
      await repository.cancel(planId);
      return "kept";
    }
    for (const hook of hooks) await hook.beforeDelete(plan);
    if (!(await purgeRuns(planId))) return "waiting";
    const outcome = await repository.deletePlan(planId);
    if (outcome === "not_due") await repository.cancel(planId);
    if (outcome === "deleted")
      logEvent({
        level: "info",
        event: "agent.plan.one_shot_deleted",
        component: "AgentPlanOneShotService",
        message: "One-time plan deleted after a successful run",
        metadata: { planId },
      });
    return outcome === "deleted" ? "deleted" : "kept";
  }
}
