import { z } from "zod";

/** A native provider's terminal receipt, separate from its raw CLI history and Pages transport session. */
export const runnerTerminalSchema = z
  .object({
    version: z.literal(1),
    provider: z.enum(["codex", "claude", "opencode"]),
    sessionId: z.string().min(1).max(200).nullable(),
    event: z.enum([
      "turn.completed",
      "turn.failed",
      "result",
      "session/prompt",
    ]),
    status: z.enum(["completed", "failed"]),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        cacheReadTokens: z.number().int().nonnegative().nullable(),
        cacheWriteTokens: z.number().int().nonnegative().nullable().optional(),
        totalTokens: z.number().int().nonnegative().nullable().optional(),
      })
      .strict(),
    eventDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    answerDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export type RunnerTerminal = z.infer<typeof runnerTerminalSchema>;
