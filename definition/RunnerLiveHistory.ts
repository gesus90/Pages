import { z } from "zod";

/** Only public CLI progress is transported; account metadata and raw protocol records are excluded. */
export const runnerLiveEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    kind: z.enum([
      "agent_message",
      "tool_started",
      "tool_completed",
      "tool_failed",
      "plan",
      "status",
      "error",
    ]),
    text: z.string().max(4_000),
    createdAt: z.string().datetime(),
    isTruncated: z.boolean(),
  })
  .strict();

/** One small, ordered packet; the worker and sender additionally enforce a 32 KiB byte budget. */
export const runnerLiveBatchSchema = z.array(runnerLiveEventSchema).max(16);
export type RunnerLiveEvent = z.infer<typeof runnerLiveEventSchema>;
