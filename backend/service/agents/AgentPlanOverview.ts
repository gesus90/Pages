import { activeStages, describePlanRun } from "./AgentPlanActiveRuns";
import { isPlanHistoryReadFailure } from "./AgentPlanControlAccess";
import { readAuthorizedPlanRun } from "./AgentPlanRunReader";
import { failureReason } from "./AgentPlanRunTransitions";
import { readPlanSnapshot } from "./AgentPlanSnapshot";

import type { AgentPlanLatestRunEntry } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun, AgentPlanSummary } from "@/definition/AgentPlan";
import type {
  AgentPlanActiveRun,
  AgentPlanActiveStep,
} from "./AgentPlanActiveRuns";
import type { AgentPlanService, PlanDependencies } from "./AgentPlanService";

/** How long a checked run counts as checked; the session check of a connection has the same pace. */
export const PLAN_OVERVIEW_CHECK_MILLISECONDS = 60_000;

/** Most runs one read checks again only because their last check expired. */
export const PLAN_OVERVIEW_MAXIMUM_EXPIRED_CHECKS = 20;

/** The failure of a run; neither field carries free text. */
export interface AgentPlanOverviewFailure {
  /** The machine code of the failure; `null` for any other content. */
  readonly code: string | null;
  /** Name of the first failed step; `null` when only the run failed. */
  readonly stepName: string | null;
}

/** What the overview tells about the latest own run of a plan. */
export interface AgentPlanOverviewRun {
  readonly id: string;
  readonly status: AgentPlanRun["status"];
  /** Names of the steps that run now, in flow order. */
  readonly runningSteps: readonly string[];
  /** Succeeded steps, without Start, End, decisions and skipped steps. */
  readonly completedSteps: number;
  /** Every step of the run, counted like {@link completedSteps}. */
  readonly totalSteps: number;
  /** Set when a step or the run failed. */
  readonly failure: AgentPlanOverviewFailure | null;
  /** End of the run, otherwise its start. */
  readonly at: string;
}

/** A plan of the overview with its latest own run. */
export interface AgentPlanOverviewEntry {
  readonly planId: string;
  readonly name: string;
  /** `null` when the person has no own run of the plan they may read. */
  readonly run: AgentPlanOverviewRun | null;
}

/**
 * The latest own run of one plan of the overview.
 *
 * @remarks
 * `gone` means the plan does not or no longer belong to the overview of the
 * person; `run: null` that it belongs there without an own run they may read.
 */
export type AgentPlanOverviewPlan =
  | { readonly kind: "gone" }
  | { readonly kind: "ok"; readonly run: AgentPlanActiveRun | null };

/** The outcome of the last check of one run. */
export interface AgentPlanCheckedRun {
  readonly runId: string;
  readonly revision: number;
  readonly checkedAt: number;
  /** `null` when the person may not read the run. */
  readonly run: AgentPlanOverviewRun | null;
}

/**
 * The checked runs of one reader of the overview, such as one connection.
 *
 * @remarks
 * A run is checked again only once it was written or its last check is older
 * than {@link PLAN_OVERVIEW_CHECK_MILLISECONDS}. The rights to the plan
 * itself are never cached.
 */
export class AgentPlanOverviewCache {
  private readonly runs = new Map<string, AgentPlanCheckedRun>();
  private userId: string | null = null;

  /**
   * Binds the cache to a person; a cache of somebody else starts empty.
   *
   * @param userId - The person the overview is read for.
   */
  public bind(userId: string): void {
    if (this.userId !== userId) {
      this.runs.clear();
      this.userId = userId;
    }
  }

  /**
   * Returns the last check of the run of a plan.
   *
   * @param planId - The plan.
   */
  public get(planId: string): AgentPlanCheckedRun | undefined {
    return this.runs.get(planId);
  }

  /**
   * Stores the check of the run of a plan.
   *
   * @param planId - The plan.
   * @param checked - The outcome.
   */
  public set(planId: string, checked: AgentPlanCheckedRun): void {
    this.runs.set(planId, checked);
  }

  /**
   * Forgets every plan that left the overview.
   *
   * @param planIds - The plans of the overview now.
   */
  public retain(planIds: ReadonlySet<string>): void {
    for (const planId of this.runs.keys()) {
      if (!planIds.has(planId)) {
        this.runs.delete(planId);
      }
    }
  }
}

function summarizeRun(
  run: AgentPlanRun,
  stages: readonly (readonly AgentPlanActiveStep[])[],
): AgentPlanOverviewRun {
  const results = new Map(run.steps.map((step) => [step.id, step]));
  // Steps on a branch a decision did not take never ran and do not count.
  const planned = stages.flat().flatMap((step) => {
    const result = results.get(step.id);

    return result === undefined || result.status === "skipped" ? [] : [result];
  });
  const failed = run.steps.find((step) => step.status === "failed");
  const hasFailed =
    failed !== undefined ||
    run.status === "failed" ||
    run.controlError !== undefined;

  return {
    id: run.id,
    status: run.status,
    runningSteps: planned
      .filter((step) => step.status === "running")
      .map((step) => step.name),
    completedSteps: planned.filter((step) => step.status === "succeeded")
      .length,
    totalSteps: planned.length,
    failure: hasFailed
      ? { code: failureReason(run), stepName: failed?.name ?? null }
      : null,
    at: run.endedAt ?? run.startedAt,
  };
}

/**
 * Lists the plans that concern a person, each with their latest own run.
 *
 * @remarks
 * A plan belongs to the overview while the person may read it and either
 * edits it (an own plan or one of their team) or started a run of it. Only
 * the latest own run is read, through the same checks as opening it on the
 * plan page; runs of others are never read. The plan rights apply on every
 * read, so a deleted plan or a revoked right leaves at once; a revoked right
 * to what a run used applies with its next check, at most a minute later.
 */
export class AgentPlanOverviewService {
  private readonly dependencies: PlanDependencies;
  private readonly plans: Pick<AgentPlanService, "control">;
  private readonly now: () => number;

  /**
   * Creates the service.
   *
   * @param dependencies - Plan rights, run storage and the checks of a run.
   * @param plans - Reads the current control state of a plan.
   * @param now - Clock in milliseconds; tests replace it.
   */
  public constructor(
    dependencies: PlanDependencies,
    plans: Pick<AgentPlanService, "control">,
    now: () => number = Date.now,
  ) {
    this.dependencies = dependencies;
    this.plans = plans;
    this.now = now;
  }

  /**
   * Reads the overview of a person.
   *
   * @param userId - The person; only their own runs are read.
   * @param cache - The checked runs of the reader, updated by the read.
   * @returns The plans in no particular order.
   * @throws When Pages cannot read the plans or a run; a refused run is no failure.
   */
  public async read(
    userId: string,
    cache: AgentPlanOverviewCache,
  ): Promise<readonly AgentPlanOverviewEntry[]> {
    const [summaries, latest] = await Promise.all([
      this.dependencies.access.summaries(userId),
      this.dependencies.runs.latestOwn(userId),
    ]);
    const latestByPlan = new Map(latest.map((entry) => [entry.planId, entry]));
    const members = summaries.filter(
      (summary) => summary.canEdit || latestByPlan.has(summary.id),
    );
    const current = this.now();

    cache.bind(userId);

    for (const entry of dueChecks(members, latestByPlan, cache, current)) {
      cache.set(entry.planId, await this.check(userId, entry, current));
    }

    cache.retain(new Set(members.map((summary) => summary.id)));

    return members.flatMap((summary) =>
      toEntry(summary, latestByPlan.get(summary.id), cache),
    );
  }

  /**
   * Reads the latest own run of one plan of the overview with its structure.
   *
   * @param userId - The person; only their own runs are read.
   * @param planId - The plan.
   * @returns The run, active or ended, or why there is none.
   * @throws When Pages cannot read the plan or the run; a refused run is no failure.
   */
  public async readPlan(
    userId: string,
    planId: string,
  ): Promise<AgentPlanOverviewPlan> {
    const [summaries, entries] = await Promise.all([
      this.dependencies.access.summaries(userId),
      this.dependencies.runs.entries(userId, planId, "newest"),
    ]);
    const summary = summaries.find((entry) => entry.id === planId);
    const [latest] = entries;

    if (summary === undefined || (latest === undefined && !summary.canEdit)) {
      return { kind: "gone" };
    }

    const run =
      latest === undefined ? null : await this.readOwnRun(userId, latest.id);

    if (run === null) {
      return summary.canEdit ? { kind: "ok", run: null } : { kind: "gone" };
    }

    return {
      kind: "ok",
      run: await describePlanRun(this.dependencies, run, (id) =>
        this.plans.control(userId, id),
      ),
    };
  }

  /** The authorized view of a run; `null` when the person may not read it. */
  private async readOwnRun(
    userId: string,
    runId: string,
  ): Promise<AgentPlanRun | null> {
    try {
      return await readAuthorizedPlanRun(this.dependencies, userId, runId);
    } catch (error: unknown) {
      // A person who lost the right to what the run used no longer sees it.
      if (isPlanHistoryReadFailure(error)) return null;
      throw error;
    }
  }

  private async check(
    userId: string,
    entry: AgentPlanLatestRunEntry,
    checkedAt: number,
  ): Promise<AgentPlanCheckedRun> {
    const checked = { runId: entry.id, revision: entry.revision, checkedAt };
    const run = await this.readOwnRun(userId, entry.id);

    if (run === null) {
      return { ...checked, run: null };
    }

    const { plan } = readPlanSnapshot(
      await this.dependencies.runs.snapshot(entry.id),
    );

    return { ...checked, run: summarizeRun(run, activeStages(plan)) };
  }
}

/**
 * The runs one read checks: every new or written run, and of the expired
 * checks the oldest {@link PLAN_OVERVIEW_MAXIMUM_EXPIRED_CHECKS}.
 */
function dueChecks(
  members: readonly AgentPlanSummary[],
  latestByPlan: ReadonlyMap<string, AgentPlanLatestRunEntry>,
  cache: AgentPlanOverviewCache,
  current: number,
): readonly AgentPlanLatestRunEntry[] {
  const changed: AgentPlanLatestRunEntry[] = [];
  const expired: { entry: AgentPlanLatestRunEntry; checkedAt: number }[] = [];

  for (const summary of members) {
    const entry = latestByPlan.get(summary.id);
    const checked = cache.get(summary.id);

    if (entry === undefined) continue;

    if (
      checked === undefined ||
      checked.runId !== entry.id ||
      checked.revision !== entry.revision
    ) {
      changed.push(entry);
    } else if (current - checked.checkedAt > PLAN_OVERVIEW_CHECK_MILLISECONDS) {
      expired.push({ entry, checkedAt: checked.checkedAt });
    }
  }

  expired.sort((first, second) => first.checkedAt - second.checkedAt);

  return [
    ...changed,
    ...expired
      .slice(0, PLAN_OVERVIEW_MAXIMUM_EXPIRED_CHECKS)
      .map(({ entry }) => entry),
  ];
}

/** The plan with its checked run; none when it belonged to the overview only through a refused run. */
function toEntry(
  summary: AgentPlanSummary,
  latest: AgentPlanLatestRunEntry | undefined,
  cache: AgentPlanOverviewCache,
): AgentPlanOverviewEntry[] {
  const run =
    latest === undefined ? null : (cache.get(summary.id)?.run ?? null);

  if (run === null && !summary.canEdit) {
    return [];
  }

  return [{ planId: summary.id, name: summary.name, run }];
}
