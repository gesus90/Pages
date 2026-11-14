import { activeAgentTodo } from "@/definition/AgentPlanAgentTodos";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";

/** Combined assignment and structured agent TODOs shown by the run panel. */
export interface AgentTodoSummary {
  readonly todos: readonly AgentPlanAgentTodo[];
  readonly done: number;
  readonly total: number;
  /** The TODO the agent reported as in progress; never the first open one. */
  readonly current: AgentPlanAgentTodo | null;
  /** Whether the step has any assigned or agent-created TODOs. */
  readonly isReported: boolean;
}

/**
 * Counts ticket, instruction and structured agent TODOs of one node result.
 *
 * @param step - The node result of the selected or running step.
 */
export function agentTodoSummary(
  step: AgentPlanStepResult | undefined,
): AgentTodoSummary {
  const assigned: AgentPlanAgentTodo[] = (
    step?.progress?.todos ??
    step?.session?.contract?.todos.map((todo) => ({
      id: todo.id,
      text: todo.text,
      status: todo.checked ? ("done" as const) : ("open" as const),
    })) ??
    []
  ).map((todo) => ({
    id: todo.id,
    text: todo.text,
    status:
      todo.status === "done" || todo.status === "active" ? todo.status : "open",
    updatedAt: step?.progress?.observedAt ?? "",
  }));
  const native = step?.agentTodos?.todos ?? [];
  const todos = [...assigned];
  for (const todo of native) {
    const existing = todos.findIndex(
      (entry) => entry.id === `A${todo.id}` || entry.text === todo.text,
    );
    if (existing < 0) todos.push(todo);
    else if (todos[existing]?.status !== "done") todos[existing] = todo;
  }
  return {
    todos,
    done: todos.filter((todo) => todo.status === "done").length,
    total: todos.length,
    current: activeAgentTodo(todos),
    isReported: todos.length > 0,
  };
}
