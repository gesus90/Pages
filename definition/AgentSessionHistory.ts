import { z } from "zod";

import type { AgentSessionEvent } from "./AgentSessionJournal";

/** Validates each complete public archive record before display or export. */
export const agentSessionEventSchema: z.ZodType<AgentSessionEvent> = z
  .object({
    id: z.string().min(1).max(400),
    sequence: z.number().int().positive().safe(),
    stepId: z.string().min(1).max(200),
    attemptId: z.string().min(1).max(300),
    turn: z.number().int().nonnegative().nullable(),
    kind: z.enum([
      "user_instruction",
      "repair_instruction",
      "agent_message",
      "tool_started",
      "tool_completed",
      "tool_failed",
      "plan",
      "status",
      "error",
      "recovery",
      "usage",
    ]),
    createdAt: z.string(),
    text: z.string().max(4000),
    isTruncated: z.boolean(),
    channel: z.enum(["stdout", "stderr"]).optional(),
  })
  .strict();
