import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";
import { PLAN_SCRIPT_BYTES } from "@/definition/AgentPlanScript";

import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

/** Additive persisted process record, also used inside immutable completion checkpoints. */
export const planScriptRunSchema = z.strictObject({
  attemptId: z.uuid(),
  instanceId: z.uuid(),
  interpreterProfileId: z.string().min(1).max(80),
  directory: z.string().min(1).max(4096),
  userId: z.string().min(1).max(200),
  uid: z.number().int().nonnegative(),
  gid: z.number().int().nonnegative(),
  processId: z.number().int().positive().nullable(),
  startedAt: z.string().max(64),
  endedAt: z.string().max(64).nullable(),
  exitCode: z.number().int().nullable(),
  signal: z.string().max(32).nullable(),
  failure: z
    .enum([
      "spawn",
      "exit",
      "signal",
      "timeout",
      "cancelled",
      "output_limit",
      "encoding",
      "credentials",
      "io",
      "cleanup",
      "interrupted",
    ])
    .nullable(),
  closeout: z.enum(["pending", "confirmed", "failed"]),
  stdout: z.string().max(PLAN_SCRIPT_BYTES.stdout).nullable(),
  stderr: z.string().max(PLAN_SCRIPT_BYTES.stderr),
});

/** Rejects malformed process diagnostics rather than treating a stored PID as live ownership. */
export function readPlanScriptRun(input: unknown): AgentPlanScriptRun {
  const parsed = planScriptRunSchema.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
}
