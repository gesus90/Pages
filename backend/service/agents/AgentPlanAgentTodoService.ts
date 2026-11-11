import { logCaughtError } from "@/backend/logging/Logger";
import { readEntries } from "@/backend/database/repositories/agent/AgentPlanAgentTodoRepository";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import { sanitizePlanOutput } from "./AgentPlanOutput";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanAgentTodoList } from "@/definition/AgentPlanAgentTodos";
import type { AgentPlanAgentTodoRepository } from "@/backend/database/repositories/agent/AgentPlanAgentTodoRepository";

function attemptOf(step: AgentPlanStepResult): string | undefined {
  return (
    (step.session ? sessionAttemptId(step.session, step.id) : undefined) ??
    step.execution?.attemptId
  );
}

/**
 * Reads the TODO lists CLIs reported through structured plans (PAGE-306).
 *
 * @remarks
 * The list is looked up by the attempt of a node result, so every iteration
 * of a loop and every member of a group shows its own list.
 */
export class AgentPlanAgentTodoService {
  private readonly todos: Pick<AgentPlanAgentTodoRepository, "listForRun">;

  public constructor(todos: Pick<AgentPlanAgentTodoRepository, "listForRun">) {
    this.todos = todos;
  }

  /**
   * Reads the lists of every attempt of a run.
   *
   * @param runId - A run the caller already authorized.
   * @returns The lists by attempt ID; a row that cannot be read is left out.
   */
  public async listForRun(
    runId: string,
  ): Promise<ReadonlyMap<string, AgentPlanAgentTodoList>> {
    const rows = await this.todos.listForRun(runId);
    return new Map(
      rows.flatMap((row) => {
        try {
          return [
            [
              row.attemptId,
              {
                attemptId: row.attemptId,
                todos: readEntries(row.todosJson).map((todo) => ({
                  ...todo,
                  text: sanitizePlanOutput(todo.text),
                })),
                updatedAt: row.updatedAt,
              },
            ] as const,
          ];
        } catch (error: unknown) {
          logCaughtError("AgentPlanAgentTodoService", error);
          return [];
        }
      }),
    );
  }
}

/**
 * Adds the reported TODO list to every node result of a run that has one, loop members included.
 *
 * @param run - The run view.
 * @param lists - The lists by attempt ID.
 */
export function withAgentTodos(
  run: AgentPlanRun,
  lists: ReadonlyMap<string, AgentPlanAgentTodoList>,
): AgentPlanRun {
  if (lists.size === 0) return run;
  function withList(step: AgentPlanStepResult): AgentPlanStepResult {
    const attemptId = attemptOf(step);
    const agentTodos = attemptId ? lists.get(attemptId) : undefined;
    return agentTodos ? { ...step, agentTodos } : step;
  }
  return {
    ...run,
    steps: run.steps.map(withList),
    ...(run.loops
      ? {
          loops: run.loops.map((loop) => ({
            ...loop,
            iterations: loop.iterations.map((iteration) => ({
              ...iteration,
              nodes: iteration.nodes.map(withList),
            })),
          })),
        }
      : {}),
  };
}
