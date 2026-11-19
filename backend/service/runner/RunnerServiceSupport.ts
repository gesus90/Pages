import { isRunnerCatalogCurrent } from "./RunnerCatalog";
import type { RunnerCatalog } from "@/definition/RunnerProtocol";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { SUPPORTED_RUNNER_RELEASES } from "@/definition/RunnerMaintenance";
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
> &
  Partial<
    Pick<
      RunnerRepository,
      "reconnected" | "archivedJob" | "archivedAttempt" | "nativePlan"
    >
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

/** Keeps the live capability of a connection exactly as its latest reconcile announced it. */
export function markRunnerSupport(
  connections: Set<string>,
  connectionId: string,
  isSupported: boolean,
): void {
  if (isSupported) connections.add(connectionId);
  else connections.delete(connectionId);
}

/** Keeps internal native progress available through either transport without trusting worker projection fields. */
export async function readRunnerProgress(
  repository: RunnerStore,
  connectionId: string,
  runId: string,
  attemptId: string,
): Promise<RunnerJob | undefined> {
  const record = await repository.find(connectionId);
  const job =
    record?.state.jobs.find(
      (entry) =>
        entry.plan?.runId === runId && entry.plan.attemptId === attemptId,
    ) ?? (await repository.archivedAttempt?.(connectionId, runId, attemptId));
  if (!job?.plan?.managed) return job;
  return {
    ...job,
    nativePlan: await repository.nativePlan?.(
      job.plan.recordingAttemptId ?? job.plan.attemptId,
    ),
  };
}

/** Reports missing execution contracts before a new remote selection can be admitted. */
export async function readRunnerAvailability(input: {
  readonly status: () => Promise<{
    readonly isPaired: boolean;
    readonly isReady: boolean;
  }>;
  readonly hasCommunication: boolean;
  readonly record: () => Promise<RunnerRecord | null>;
  readonly catalog: () => Promise<RunnerCatalog | undefined>;
}): Promise<
  | "remoteIdentity"
  | "remoteOffline"
  | "remoteRunnerUpdate"
  | "remoteCatalogStale"
  | null
> {
  const status = await input.status();
  if (!status.isPaired) return "remoteIdentity";
  if (!status.isReady) return "remoteOffline";
  const record = await input.record();
  if (
    !SUPPORTED_RUNNER_RELEASES.includes(record?.state.runnerVersion ?? "") ||
    !input.hasCommunication ||
    record?.state.executionLeaseVersion !== 1 ||
    record.state.planControlVersion !== 1 ||
    record.state.managedExecutionVersion !== 1
  )
    return "remoteRunnerUpdate";
  return isRunnerCatalogCurrent(await input.catalog())
    ? null
    : "remoteCatalogStale";
}
