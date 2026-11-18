import { z } from "zod";

import { readNullableTextColumn } from "@/backend/database/RowValue";

import type { DatabaseValue } from "@/backend/database/Database";
import type { StoredAgentAnswer } from "@/definition/ConversationLiveAnswer";

const agentAnswerSchema = z.object({
  answerId: z.string(),
  durationMs: z.number().int().nonnegative(),
  tools: z.array(
    z.object({
      callId: z.string(),
      name: z.string(),
      status: z.enum(["running", "completed", "failed", "cancelled"]),
      summary: z.string().optional(),
      input: z.string().optional(),
      output: z.string().optional(),
      error: z.string().nullable().optional(),
      isNative: z.boolean().optional(),
      startedAt: z.iso.datetime(),
      endedAt: z.iso.datetime().optional(),
    }),
  ),
});

/** Reads the server-recorded measurement, absent for messages without one. */
export function readAgentAnswer(
  row: readonly DatabaseValue[],
  index: number,
): { readonly agentAnswer?: StoredAgentAnswer } {
  const text = readNullableTextColumn(row, index, "agent_answer");
  if (text === null) return {};
  return { agentAnswer: agentAnswerSchema.parse(JSON.parse(text)) };
}
