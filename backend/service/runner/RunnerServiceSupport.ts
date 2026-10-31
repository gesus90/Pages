import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import type {
  RunnerRepository,
  RunnerRecord,
} from "@/backend/database/repositories/runner/RunnerRepository";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import type { RunnerJob, RunnerPlanBinding } from "@/definition/RunnerProtocol";
import type { RunnerExecution } from "@/definition/RunnerExecution";
export interface RegistrationGrant {
  readonly digest: string;
  readonly userId: string;
  readonly revision: number;
  readonly expiresAt: number;
}

export type RunnerStore = Pick<
  RunnerRepository,
  "find" | "create" | "checkpoint" | "remove"
>;
export type RunnerConnectionAccess = Pick<
  RemoteConnectionService,
  "scope" | "scopeForRunner" | "requireUsable"
>;

/** Pairing grants expire before a durable machine credential exists. */
export const GRANT_MILLISECONDS = 120_000;

/** Hashes machine credentials before persistence. */
export function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compares fixed-size credential digests. */
export function matches(token: string, expected: string): boolean {
  return timingSafeEqual(
    Buffer.from(digest(token), "hex"),
    Buffer.from(expected, "hex"),
  );
}

const FINISHED_RUNNER_JOB_STATUSES: ReadonlySet<RunnerJob["status"]> = new Set([
  "completed",
  "failed",
  "interrupted",
  "lost",
]);

/** Dispatch retries retain the original attempt only when command and binding are identical. */
export function repeatedRunnerJob(
  record: RunnerRecord,
  binding: RunnerPlanBinding,
  execution: RunnerExecution | undefined,
  allowTerminalRerun = false,
): RunnerJob | undefined {
  const matching = record.state.jobs.filter(
    (job) => job.plan?.attemptId === binding.attemptId,
  );
  if (matching.length === 0) return undefined;
  const active = matching.find(
    (job) => !FINISHED_RUNNER_JOB_STATUSES.has(job.status),
  );
  const previous = active ?? matching.at(-1);
  if (!previous) return undefined;
  if (planContentDigest(previous.plan) !== planContentDigest(binding))
    throw new Error("Conflicting runner plan binding");
  if (active) {
    if (planContentDigest(previous.execution) !== planContentDigest(execution))
      throw new Error("Conflicting runner command");
    return active;
  }
  if (allowTerminalRerun) return undefined;
  if (planContentDigest(previous.execution) !== planContentDigest(execution))
    throw new Error("Conflicting runner command");
  return previous;
}

/** Allocates the durable identity of a newly dispatched job, before any delivery. */
export function queuedRunnerJob(input: {
  readonly sessionId: string;
  readonly binding?: RunnerPlanBinding;
  readonly execution?: RunnerExecution;
  readonly hasLiveHistory: boolean;
}): RunnerJob {
  return {
    ...(input.hasLiveHistory && input.execution?.program.kind === "cli"
      ? {
          liveHistoryVersion: 1 as const,
          outputJournalVersion: 2 as const,
          historyCursor: 0,
        }
      : {}),
    ...(input.binding ? { plan: input.binding } : {}),
    ...(input.execution ? { execution: input.execution } : {}),
    jobId: randomUUID(),
    sessionId: input.sessionId,
    status: "queued",
  };
}
