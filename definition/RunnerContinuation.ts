import { z } from "zod";

/** Runner 1.16.0 keeps the native session of a writing one-shot and proves what it did. */
export const RUNNER_CONTINUATION_VERSION = 1;

/**
 * What Pages asks of a CLI job so that a later job can continue it.
 *
 * @remarks
 * Without `resumeSessionId` the job opens a session that stays on the
 * runner's host and reports its identity and tool activity. With it, the
 * job continues exactly that native session; when the tool cannot find it the
 * job fails with `acp_session_resume_failed` and never starts a new
 * conversation in its place.
 */
export const runnerContinuationRequestSchema = z
  .object({
    version: z.literal(RUNNER_CONTINUATION_VERSION),
    resumeSessionId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type RunnerContinuationRequest = z.infer<
  typeof runnerContinuationRequestSchema
>;

/**
 * What the runner proved about the session of a job, whether it succeeded or not.
 *
 * @remarks
 * `tools` is `none` only when the runner followed the whole stream and saw no
 * tool call, `observed` when it saw at least one, and `unknown` when the
 * stream did not allow either statement. The runner reports this only for a
 * job that asked for continuation.
 */
export const runnerContinuationEvidenceSchema = z
  .object({
    version: z.literal(RUNNER_CONTINUATION_VERSION),
    sessionId: z.string().min(1).max(200).nullable(),
    canResume: z.boolean(),
    tools: z.enum(["none", "observed", "unknown"]),
    calls: z.number().int().min(0).max(1_000_000),
  })
  .strict();
export type RunnerContinuationEvidence = z.infer<
  typeof runnerContinuationEvidenceSchema
>;
