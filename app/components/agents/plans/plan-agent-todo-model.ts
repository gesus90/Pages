import { activeAgentTodo } from "@/definition/AgentPlanAgentTodos";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";

/** What the status bar and the lists show of the TODO list an agent reported (PAGE-306). */
export interface AgentTodoSummary {
  readonly todos: readonly AgentPlanAgentTodo[];
  readonly done: number;
  readonly total: number;
  /** The TODO the agent reported as in progress; never the first open one. */
  readonly current: AgentPlanAgentTodo | null;
  /** Whether the CLI reported a list at all. */
  readonly isReported: boolean;
}

/**
 * Counts the TODO list the CLI reported for the node result.
 *
 * @param step - The node result of the selected or running step.
 */
export function agentTodoSummary(
  step: AgentPlanStepResult | undefined,
): AgentTodoSummary {
  const todos = step?.agentTodos?.todos ?? [];
  return {
    todos,
    done: todos.filter((todo) => todo.status === "done").length,
    total: todos.length,
    current: activeAgentTodo(todos),
    isReported: todos.length > 0,
  };
}
