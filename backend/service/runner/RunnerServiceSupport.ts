import { createHash, timingSafeEqual } from "node:crypto";
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

/** Dispatch retries retain the original attempt only when command and binding are identical. */
export function repeatedRunnerJob(
  record: RunnerRecord,
  binding: RunnerPlanBinding,
  execution: RunnerExecution | undefined,
): RunnerJob | undefined {
  const previous = record.state.jobs.find(
    (job) => job.plan?.attemptId === binding.attemptId,
  );
  if (!previous) return undefined;
  if (planContentDigest(previous.plan) !== planContentDigest(binding))
    throw new Error("Conflicting runner plan binding");
  if (planContentDigest(previous.execution) !== planContentDigest(execution))
    throw new Error("Conflicting runner command");
  return previous;
}
