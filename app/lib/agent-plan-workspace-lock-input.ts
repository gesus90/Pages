import { z } from "zod";

import type { AgentPlanWorkspaceLock } from "@/definition/AgentPlanWorkspaceLock";

const workspaceLocksSchema = z.array(
  z.object({
    runId: z.string().min(1),
    planId: z.string().min(1),
    status: z.enum([
      "running",
      "pausing",
      "paused",
      "stopping",
      "succeeded",
      "failed",
      "cancelled",
      "work_done_closeout_open",
    ]),
    acquiredAt: z.iso.datetime(),
    ageMilliseconds: z.number().int().nonnegative(),
    reason: z.enum(["active", "resumable", "cleanup"]),
    isOverdue: z.boolean(),
    canRelease: z.boolean(),
  }),
);

/** Preserves authorized reservation facts and rejects malformed polling responses. */
export function readPlanWorkspaceLocks(
  input: unknown,
): readonly AgentPlanWorkspaceLock[] {
  return workspaceLocksSchema.parse(input);
}
