import { z } from "zod";

// Runner 1.10 progress facts of a plan step. This file stays free of runner
// imports because the MCP package type-checks the plan contracts that use it.

/** A durable request is separate from delivery and from verified process termination. */
export const runnerCancellationSchema = z.object({
  requestedAt: z.string().datetime(),
  receivedAt: z.string().datetime().optional(),
});

/** Resource admission never changes a queued job's attempt or command. */
export const runnerQueueReasonSchema = z.enum(["capacity", "workspace"]);

/** Public transport facts do not imply that an individual remote process is alive. */
export const runnerContactSchema = z.object({
  state: z.enum(["connected", "lost", "unknown"]),
  lastContactAt: z.string().datetime().nullable(),
});
