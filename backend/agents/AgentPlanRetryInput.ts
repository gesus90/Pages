import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";
import { PLAN_RETRY_HISTORY_LIMIT } from "@/definition/AgentPlanRetry";

import type {
  AgentPlanFailureStop,
  AgentPlanRetry,
  AgentProviderFailure,
} from "@/definition/AgentPlanRetry";

const blockerClass = z.enum(["harm", "form", "infrastructure", "open"]);
const timestamp = z.iso.datetime();
const providerFailure = z.object({
  code: z.enum([
    "provider_unreachable",
    "provider_unavailable",
    "provider_rate_limited",
    "provider_quota_exhausted",
  ]),
  resetAt: timestamp.nullable(),
});
const retry = z
  .object({
    policy: z.enum(["provider", "session"]).optional(),
    failureClass: blockerClass.optional(),
    state: z.enum(["waiting", "running", "blocked", "completed", "cancelled"]),
    reason: z.enum([
      "transient",
      "quota",
      "repair",
      "hard_stop",
      "reset_unknown",
      "exhausted",
      "unsafe",
      "closeout_unconfirmed",
      "resume_unavailable",
      "session_not_kept",
      "remote_evidence_missing",
      "effect_unknown",
      "session",
      "failed",
    ]),
    nextAttemptAt: timestamp.nullable(),
    resetAt: timestamp.nullable(),
    requiredResumeSessionId: z.string().min(1).max(4_000).optional(),
    attempts: z
      .array(
        z.object({
          attemptId: z.string().max(100).nullable(),
          sessionId: z.string().max(4_000).nullable(),
          endedAt: timestamp,
          code: z.string().min(1).max(100),
          failureClass: blockerClass.optional(),
          issues: z.array(z.string().max(200)).max(50).optional(),
        }),
      )
      .min(1)
      .max(PLAN_RETRY_HISTORY_LIMIT),
  })
  .refine((record) =>
    record.state === "waiting"
      ? record.nextAttemptAt !== null
      : record.nextAttemptAt === null,
  );

const failureStop = z.strictObject({
  failureClass: blockerClass,
  attempts: z.number().int().min(1).max(PLAN_RETRY_HISTORY_LIMIT),
  maximumAttempts: z.number().int().min(1).max(PLAN_RETRY_HISTORY_LIMIT),
  totalAttempts: z.number().int().min(1).max(PLAN_RETRY_HISTORY_LIMIT),
});

/** Validates the stored reason a failed step stopped. */
export function readPlanFailureStop(input: unknown): AgentPlanFailureStop {
  const parsed = failureStop.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
}

/** Keeps historical records without provider retry metadata readable. */
export function readPlanProviderFailure(input: unknown): AgentProviderFailure {
  const parsed = providerFailure.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
}

/** Validates persisted retry timing and bounded attempt history before a run is read. */
export function readPlanRetry(input: unknown): AgentPlanRetry {
  const parsed = retry.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
}
