import { createHash } from "node:crypto";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanContract } from "@/backend/agents/AgentPlanSessionInput";

import type {
  AgentPlanContract,
  AgentPlanContractItem,
} from "@/definition/AgentPlanSession";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";
import type { AgentPlanStepProgressTodo } from "@/definition/AgentPlanStepProgress";
import type { StoredPlanStepProgress } from "@/backend/database/repositories/agent/AgentPlanStepProgressRepository";

/** Private progress envelope; legacy rows containing only a todo array remain readable. */
export interface AgentPlanTodoState {
  readonly scope: string;
  readonly contract: AgentPlanContract | null;
  readonly todos: readonly AgentPlanStepProgressTodo[];
}

/** Identifies work independently of its position and of the attempt that runs it. */
export function planTodoKey(todo: AgentPlanContractItem): string {
  return todo.ticket
    ? JSON.stringify([todo.ticket.id, todo.ticket.itemId, todo.text])
    : JSON.stringify([todo.agent === true, todo.id, todo.text]);
}

/** Reads current and historical progress without manufacturing a completed todo. */
export function readTodoState(
  stored: StoredPlanStepProgress | null,
): AgentPlanTodoState {
  if (!stored) return { scope: "", contract: null, todos: [] };
  const parsed: unknown = JSON.parse(stored.todosJson);
  const envelope: Record<string, unknown> = Array.isArray(parsed)
    ? { todos: parsed }
    : readAgentObject(parsed);
  const todos = Array.isArray(envelope.todos) ? envelope.todos : [];
  return {
    scope: typeof envelope.scope === "string" ? envelope.scope : "",
    contract: readPlanContract(envelope.contract),
    todos: todos.flatMap((entry: unknown) => {
      const todo = readAgentObject(entry);
      return typeof todo.id === "string" &&
        (todo.status === "open" ||
          todo.status === "active" ||
          todo.status === "done")
        ? [{ id: todo.id, status: todo.status }]
        : [];
    }),
  };
}

/** Reconciles a fresh assignment with the completed work of the same iteration. */
export function retainTodoState(
  contract: AgentPlanContract,
  earlier: AgentPlanTodoState,
): AgentPlanContract {
  const previous = earlier.contract?.todos ?? [];
  let nextId = Math.max(
    0,
    ...previous
      .filter((todo) => !todo.agent)
      .map((todo) => Number(todo.id.slice(1)) || 0),
  );
  const todos = contract.todos.map((todo) => {
    const original = previous.find(
      (entry) => planTodoKey(entry) === planTodoKey(todo),
    );
    const status = earlier.todos.find(
      (entry) => entry.id === original?.id,
    )?.status;
    return {
      ...todo,
      id: original?.id ?? `T${++nextId}`,
      ...(!todo.ticket && (original?.checked || status === "done")
        ? { checked: true }
        : {}),
    };
  });
  return {
    ...contract,
    todos: [...todos, ...previous.filter((todo) => todo.agent)],
  };
}

/** Adds structured agent plans without duplicating work already bound to a ticket. */
export function withNativeTodoState(
  contract: AgentPlanContract,
  native: readonly AgentPlanAgentTodo[],
  statuses: ReadonlyMap<string, AgentPlanStepProgressTodo["status"]>,
): AgentPlanContract {
  const todos = [...contract.todos];
  const occurrences = new Map<string, number>();
  for (const todo of native) {
    const occurrence = occurrences.get(todo.text) ?? 0;
    occurrences.set(todo.text, occurrence + 1);
    const id = `A${createHash("sha256")
      .update(JSON.stringify([todo.text, occurrence]))
      .digest("hex")
      .slice(0, 16)}`;
    const existing = todos.findIndex((entry) => entry.agent && entry.id === id);
    const item: AgentPlanContractItem = {
      id,
      text: todo.text,
      ticket: null,
      agent: true,
      checked:
        todo.status === "done" ||
        statuses.get(id) === "done" ||
        todos[existing]?.checked === true,
    };
    if (existing >= 0) todos[existing] = item;
    else if (!todos.some((entry) => entry.text === todo.text)) todos.push(item);
  }
  return { ...contract, todos };
}
