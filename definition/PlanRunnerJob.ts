import { z } from "zod";

/** Durable ownership retained independently of scheduler observers and native session records. */
export const planRunnerJobSchema = z
  .object({
    connectionId: z.uuid(),
    jobId: z.uuid(),
    attemptId: z.uuid(),
    recordingAttemptId: z.uuid().optional(),
    stepId: z.string().min(1).max(400),
    ownerStepId: z.string().min(1).max(400),
    status: z.enum([
      "queued",
      "accepted",
      "running",
      "completed",
      "failed",
      "interrupted",
      "lost",
    ]),
    closeout: z.enum(["pending", "confirmed", "failed"]),
  })
  .strict();
export type PlanRunnerJob = z.infer<typeof planRunnerJobSchema>;

/** Reconciles confirmed worker receipts without letting stale scheduler views reopen ownership. */
export function mergeConfirmedRunnerJobs(
  current: readonly PlanRunnerJob[] | undefined,
  incoming: readonly PlanRunnerJob[] | undefined,
): readonly PlanRunnerJob[] | undefined {
  if (!current) return incoming;
  return current.map((job) => {
    if (job.closeout === "confirmed") return job;
    const confirmed = incoming?.find(
      (candidate) =>
        candidate.jobId === job.jobId &&
        candidate.connectionId === job.connectionId &&
        candidate.attemptId === job.attemptId &&
        candidate.stepId === job.stepId &&
        candidate.ownerStepId === job.ownerStepId &&
        candidate.closeout === "confirmed",
    );
    return confirmed ?? job;
  });
}
