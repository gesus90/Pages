import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";
import { PLAN_MAXIMUM_RETRIES } from "@/definition/AgentPlanRetry";

import type {
  AgentPlanRetry,
  AgentProviderFailure,
} from "@/definition/AgentPlanRetry";

const retryCode = z.enum([
  "provider_unreachable",
  "provider_unavailable",
  "provider_rate_limited",
  "provider_quota_exhausted",
]);
const timestamp = z.iso.datetime();
const providerFailure = z.object({
  code: retryCode,
  resetAt: timestamp.nullable(),
});
const retry = z
  .object({
    state: z.enum(["waiting", "running", "blocked", "completed", "cancelled"]),
    reason: z.enum([
      "transient",
      "quota",
      "reset_unknown",
      "exhausted",
      "unsafe",
    ]),
    nextAttemptAt: timestamp.nullable(),
    resetAt: timestamp.nullable(),
    attempts: z
      .array(
        z.object({
          attemptId: z.string().max(100).nullable(),
          sessionId: z.string().max(4_000).nullable(),
          endedAt: timestamp,
          code: retryCode,
        }),
      )
      .min(1)
      .max(PLAN_MAXIMUM_RETRIES + 1),
  })
  .refine((record) =>
    record.state === "waiting"
      ? record.nextAttemptAt !== null
      : record.nextAttemptAt === null,
  );

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
