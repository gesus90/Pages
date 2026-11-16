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

function assignedAgentTodos(
  step: AgentPlanStepResult | undefined,
): AgentPlanAgentTodo[] {
  const progressTodos = step?.progress?.todos;
  const source =
    progressTodos ??
    step?.session?.contract?.todos.map((todo) => ({
      id: todo.id,
      text: todo.text,
      status: todo.checked ? ("done" as const) : ("open" as const),
    })) ??
    [];
  const observedAt = step?.progress?.observedAt ?? "";
  return source
    .filter((todo) => todo.id !== "PAGES_PLAN")
    .map((todo) => ({
      id: todo.id,
      text: todo.text,
      status:
        todo.status === "done" ||
        todo.status === "active" ||
        todo.status === "failed"
          ? todo.status
          : "open",
      updatedAt: observedAt,
    }));
}

function shouldReplaceAssignedTodo(
  step: AgentPlanStepResult | undefined,
  existing: AgentPlanAgentTodo | undefined,
): boolean {
  return (
    step?.session?.runner === "codex_cli" ||
    step?.execution?.modelAccess.provider === "codex_cli" ||
    existing?.status !== "done"
  );
}

/**
 * Counts ticket, instruction and structured agent TODOs of one node result.
 * @param step - The node result of the selected or running step.
 */
export function agentTodoSummary(
  step: AgentPlanStepResult | undefined,
): AgentTodoSummary {
  // The server-only native-plan obligation is a completion gate, not agent work.
  const todos = assignedAgentTodos(step);
  const native = step?.agentTodos?.todos ?? [];
  for (const todo of native) {
    const existing = todos.findIndex(
      (entry) => entry.id === `A${todo.id}` || entry.text === todo.text,
    );
    if (existing < 0) todos.push(todo);
    else if (shouldReplaceAssignedTodo(step, todos[existing]))
      todos[existing] = todo;
  }
  return {
    todos,
    done: todos.filter((todo) => todo.status === "done").length,
    total: todos.length,
    current: activeAgentTodo(todos),
    isReported: todos.length > 0,
  };
}

/** Counts the structured TODOs reported by the agent. */
export function nativeAgentTodoSummary(
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
