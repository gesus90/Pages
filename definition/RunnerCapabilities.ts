import { z } from "zod";

/** Optional host contracts; new managed plan dispatch requires its declared version. */
export const runnerCapabilityFields = {
  managedExecutionVersion: z.literal(1).optional(),
  isolationVersion: z.literal(1).optional(),
  executionControlVersion: z.literal(1).optional(),
  cgroupVersion: z.literal(1).optional(),
  agentAccountsVersion: z.literal(1).optional(),
  browserVersion: z.literal(1).optional(),
  progressVersion: z.literal(1).optional(),
};

/** Kernel-confirmed execution state, independent of the requested plan state. */
export const runnerExecutionControlSchema = z
  .object({
    state: z.enum(["frozen", "thawed", "terminated", "unavailable", "failed"]),
    observedAt: z.string().datetime(),
    requestedAt: z.string().datetime(),
    isPaused: z.boolean(),
  })
  .strict();
export type RunnerExecutionControl = z.infer<
  typeof runnerExecutionControlSchema
>;
