import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  AGENT_TODO_LIMIT,
  AGENT_TODO_STATUSES,
  AGENT_TODO_TEXT_LENGTH,
} from "@/definition/AgentPlanAgentTodos";

import type { AgentPlanAgentTodoList } from "@/definition/AgentPlanAgentTodos";

const todoListSchema = z.strictObject({
  attemptId: z.string().min(1).max(500),
  updatedAt: z.string().min(1).max(100),
  todos: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(20),
        text: z.string().max(AGENT_TODO_TEXT_LENGTH * 2),
        status: z.enum(AGENT_TODO_STATUSES),
        updatedAt: z.string().min(1).max(100),
      }),
    )
    .max(AGENT_TODO_LIMIT),
});

/**
 * Validates the reported TODO list of a step result.
 *
 * @param input - The JSON of a run view.
 * @throws {AgentError} `plan_invalid` for anything but a list of TODOs.
 */
export function readAgentTodoList(input: unknown): AgentPlanAgentTodoList {
  const parsed = todoListSchema.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
}
