import type { AgentPlanService } from "../AgentPlanService";
import type { ReadableRun } from "./AgentPlanRunTeamReader";

/** What the reads of one run need of the plan service; `readableRun` is the team-wide rule (PAGE-307). */
export type RunReadingPlans = Pick<AgentPlanService, "run"> &
  Partial<Pick<AgentPlanService, "readableRun">>;

/**
 * Reads a run for reading.
 *
 * @param plans - The plan service; a stand-in without the team-wide rule reads the executor's own run.
 * @param userId - The reader.
 * @param runId - The run.
 * @throws {AgentError} `plan_access_denied` for a run the reader may not see.
 */
export async function readRunForReading(
  plans: RunReadingPlans,
  userId: string,
  runId: string,
): Promise<ReadableRun> {
  if (plans.readableRun) return plans.readableRun(userId, runId);
  const run = await plans.run(userId, runId);
  return {
    run,
    startedBy: { id: run.userId, displayName: run.userId },
    hiddenFields: [],
    hiddenSources: [],
  };
}
