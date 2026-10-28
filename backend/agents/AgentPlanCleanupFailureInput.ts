import { z } from "zod";

import { readPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type { AgentPlanCleanupFailureRecord } from "@/definition/AgentPlanCleanupResource";

const record = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  planId: z.string().min(1).max(4096),
  runId: z.string().min(1).max(4096),
  planRevision: z.number().int().positive(),
  recoveryRevision: z.number().int().nonnegative(),
  action: z.enum(["release", "restart", "resume"]),
  attemptId: z.string().uuid().nullable(),
});

/** Validates stored evidence and discards every field outside the public allowlist. */
export function readCleanupFailureRecord(
  input: unknown,
): AgentPlanCleanupFailureRecord {
  const failure = readPlanCleanupFailure(input);
  const metadata = record.safeParse(input);
  if (!failure || !metadata.success)
    throw new AgentPlanRecoveryError("diagnostic_unavailable");
  return { ...metadata.data, ...failure };
}
