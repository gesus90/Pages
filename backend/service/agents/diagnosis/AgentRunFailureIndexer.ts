import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import {
  extractRunFailures,
  runStepResults,
  stepTimes,
  summarizeRunFailure,
} from "./RunFailures";

import type {
  AgentRunFailureRepository,
  RunFailureIndexEntry,
  RunToIndex,
} from "@/backend/database/repositories/diagnosis/AgentRunFailureRepository";
import type { AgentRunDiagnosisSettingsRepository } from "@/backend/database/repositories/diagnosis/AgentRunDiagnosisSettingsRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Runs classified per statement round; the index catches up in rounds so a read never waits long. */
const BATCH_SIZE = 100;
const MAXIMUM_BATCHES = 20;
const DAY_MS = 86_400_000;

function runEnd(run: AgentPlanRun): string | null {
  if (isActivePlanRun(run.status)) return null;
  if (run.endedAt) return run.endedAt;
  const ends = runStepResults(run).flatMap((step) => {
    const { endedAt } = stepTimes(step);
    return endedAt ? [endedAt] : [];
  });
  return ends.sort().at(-1) ?? null;
}

/**
 * Classifies the failures of a stored run.
 *
 * @param stored - The run as read for indexing.
 * @returns What the index keeps; a damaged record has no failures.
 */
export function buildFailureIndexEntry(
  stored: RunToIndex,
): RunFailureIndexEntry {
  const { run } = stored;
  const failures = run ? extractRunFailures(run) : [];
  const summary = run ? summarizeRunFailure(run, failures) : null;
  return {
    runId: stored.runId,
    revision: stored.revision,
    planId: stored.planId,
    planName: run?.planName ?? stored.planId,
    projectId: stored.projectId,
    startedById: stored.startedById,
    endedAt: run ? runEnd(run) : null,
    failedStepId: summary?.failedStepId ?? null,
    errorClass: summary?.errorClass ?? null,
    errorCode: summary?.errorCode ?? null,
    failures: failures.map((failure) => ({
      stepId: failure.stepId,
      stepLabel: failure.stepLabel,
      loopId: failure.loopId,
      iteration: failure.iteration,
      attemptId: failure.attemptId,
      errorClass: failure.errorClass,
      errorCode: failure.errorCode,
      occurredAt: failure.occurredAt,
    })),
  };
}

/**
 * Classifies one run now and stores its failures.
 *
 * @param failures - The failure store.
 * @param runId - The run; a missing run is ignored.
 */
export async function indexRunFailures(
  failures: Pick<AgentRunFailureRepository, "load" | "replace">,
  runId: string,
): Promise<void> {
  const stored = await failures.load(runId);
  if (stored) await failures.replace(buildFailureIndexEntry(stored));
}

/**
 * Keeps the failure index of runs current.
 *
 * @remarks
 * Runs are written in several processes, so the index is not driven by a
 * write hook: before a list or an overview reads it, runs whose write
 * revision differs from the indexed one are classified again. Runs of before
 * the classes existed are caught up the same way.
 */
export class AgentRunFailureIndexer {
  private readonly failures: AgentRunFailureRepository;
  private readonly settings: Pick<AgentRunDiagnosisSettingsRepository, "read">;
  private readonly now: () => number;
  private running: Promise<void> | null = null;

  public constructor(
    failures: AgentRunFailureRepository,
    settings: Pick<AgentRunDiagnosisSettingsRepository, "read">,
    now: () => number = Date.now,
  ) {
    this.failures = failures;
    this.settings = settings;
    this.now = now;
  }

  /** Brings the index up to date; overlapping calls share one pass. */
  public async refresh(): Promise<void> {
    this.running ??= this.catchUp().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async catchUp(): Promise<void> {
    const { logRetentionDays } = await this.settings.read();
    const since = new Date(
      this.now() - logRetentionDays * DAY_MS,
    ).toISOString();
    for (let batch = 0; batch < MAXIMUM_BATCHES; batch += 1) {
      const runIds = await this.failures.pending(since, BATCH_SIZE);
      for (const runId of runIds) await indexRunFailures(this.failures, runId);
      if (runIds.length < BATCH_SIZE) return;
    }
  }
}
