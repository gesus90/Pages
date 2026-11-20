import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { preparePlanTemporaryDirectory } from "../PlanRunTemporaryDirectory";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { CliSessionRequest } from "./CliContracts";

const JOB_TEMPORARY_SUBDIRECTORY = "jobs";
const activeJobs = new Map<string, number>();

function pathSegment(identifier: string): string {
  if (!identifier || identifier === "." || identifier === "..")
    throw new Error("Invalid job temporary directory identifier");
  return encodeURIComponent(identifier);
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.()
  )
    throw new Error("Job temporary directory ownership could not be confirmed");
  await chmod(directory, 0o700);
}

function retainActiveJob(jobId: string): void {
  activeJobs.set(jobId, (activeJobs.get(jobId) ?? 0) + 1);
}

/** Releases active-job tracking for a job without removing its folder on disk. */
export function releaseJobTemporaryDirectory(jobId: string): void {
  const remaining = (activeJobs.get(jobId) ?? 0) - 1;
  if (remaining > 0) activeJobs.set(jobId, remaining);
  else activeJobs.delete(jobId);
}

/** Root directory holding per-job temporary folders under `~/.pages/tmp/jobs`. */
export function jobTemporaryRoot(): string {
  return pagesTempDirectory(JOB_TEMPORARY_SUBDIRECTORY);
}

/** Resolves the private folder of one chat or CLI job without accepting path traversal. */
export function jobTemporaryDirectory(jobId: string): string {
  return path.join(jobTemporaryRoot(), pathSegment(jobId));
}

/** Writable scratch directory inside one job folder, separate from sibling isolation mounts. */
export function jobTemporaryMountDirectory(jobId: string): string {
  return path.join(jobTemporaryDirectory(jobId), "tmp");
}

/** Reports job identifiers whose temporary directories are currently owned by live sessions. */
export function activeJobTemporaryIds(): ReadonlySet<string> {
  return new Set(activeJobs.keys());
}

/** Whether a session receives a per-job temporary directory rather than a plan-step directory. */
export function usesJobTemporaryDirectory(
  input: Pick<AgentPlanSessionInput, "chat" | "resourceContext">,
): boolean {
  return input.chat !== undefined || !input.resourceContext;
}

/** Creates a private temporary directory for a chat or CLI job and marks the job active. */
export async function prepareJobTemporaryDirectory(
  jobId: string,
): Promise<string> {
  const root = jobTemporaryRoot();
  await ensurePrivateDirectory(root);
  const directory = jobTemporaryDirectory(jobId);
  await ensurePrivateDirectory(directory);
  const mountDirectory = jobTemporaryMountDirectory(jobId);
  await ensurePrivateDirectory(mountDirectory);
  retainActiveJob(jobId);
  return mountDirectory;
}

/** Removes a job's temporary directory and clears its active-job registration. */
export async function removeJobTemporaryDirectory(
  jobId: string,
): Promise<void> {
  try {
    await rm(jobTemporaryDirectory(jobId), { recursive: true, force: true });
  } finally {
    releaseJobTemporaryDirectory(jobId);
  }
}

/** Cleanup callbacks for a session that owns a per-job temporary directory. */
export interface JobTemporaryCleanup {
  readonly cleanupTemporaryDirectory?: () => Promise<void>;
  readonly releaseTemporaryDirectory?: () => void;
}

/** Returns cleanup callbacks for chat and standalone CLI jobs, and empty object for plan steps. */
export function jobTemporaryCleanup(
  input: Pick<AgentPlanSessionInput, "chat" | "resourceContext" | "instanceId">,
): JobTemporaryCleanup {
  if (!usesJobTemporaryDirectory(input)) return {};
  return {
    cleanupTemporaryDirectory: () =>
      removeJobTemporaryDirectory(input.instanceId),
    releaseTemporaryDirectory: () =>
      releaseJobTemporaryDirectory(input.instanceId),
  };
}

/**
 * Attaches the disk-backed temporary directory of a plan step or chat/CLI job to a worker.
 * @remarks
 * Plan steps keep a run-scoped directory reused across pauses; chat and
 * standalone CLI jobs receive a dedicated directory under `~/.pages/tmp/jobs/`
 * removed as soon as the session ends.
 */
export async function attachPlanTemporaryDirectory(
  worker: CliSessionRequest,
  input: AgentPlanSessionInput,
): Promise<CliSessionRequest> {
  const context = input.resourceContext;
  if (context && !input.chat)
    return {
      ...worker,
      temporaryDirectory: await preparePlanTemporaryDirectory({
        runId: context.runId,
        stepId: context.sessionScopeId ?? context.stepId,
      }),
    };
  return {
    ...worker,
    temporaryDirectory: await prepareJobTemporaryDirectory(input.instanceId),
  };
}
