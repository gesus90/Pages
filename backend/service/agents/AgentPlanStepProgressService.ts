import { z } from "zod";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanContract } from "@/backend/agents/AgentPlanSessionInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  AGENT_STEP_ACTIVITY_LENGTH,
  AGENT_STEP_PROGRESS_STATUSES,
} from "@/definition/AgentPlanStepProgress";

import { sanitizeArtifactText } from "./AgentPlanOutput";

import type {
  AgentPlanStepLiveProgress,
  AgentPlanStepProgressReceipt,
  AgentPlanStepProgressTodo,
} from "@/definition/AgentPlanStepProgress";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import type {
  AgentPlanStepProgressRepository,
  StoredPlanStepProgress,
} from "@/backend/database/repositories/agent/AgentPlanStepProgressRepository";

const MAXIMUM_PROBLEMS = 50;

const identifier = z.string().trim().min(1).max(200);
const todoSchema = z.strictObject({
  id: identifier,
  status: z.enum(AGENT_STEP_PROGRESS_STATUSES),
});
const callSchema = z.strictObject({
  todos: z.array(todoSchema).min(1).max(1000),
  activity: z.string().trim().min(1).max(AGENT_STEP_ACTIVITY_LENGTH).optional(),
});
const storedSchema = z.array(todoSchema);

function rejection(
  code: "INVALID_REQUEST" | "FORBIDDEN" | "CONFLICT",
  reason: "step_report_invalid" | "step_report_closed",
  problems: readonly string[],
): AgentOperationError {
  return new AgentOperationError(code, {
    reason,
    problems: problems.slice(0, MAXIMUM_PROBLEMS),
  });
}

/** The todo IDs of the attempt's contract, in their order. */
function contractTodoIds(termsJson: string): readonly string[] {
  const terms = readAgentObject(JSON.parse(termsJson));
  const contract = readPlanContract(terms.contract);
  if (!contract) throw new Error("Invalid step report terms");
  return contract.todos.map((todo) => todo.id);
}

function storedTodos(
  stored: StoredPlanStepProgress | null,
): readonly AgentPlanStepProgressTodo[] {
  if (!stored) return [];
  const parsed = storedSchema.safeParse(JSON.parse(stored.todosJson));
  return parsed.success ? parsed.data : [];
}

/** The earlier state with the reported todos replaced, in the order of the contract. */
function mergedTodos(
  order: readonly string[],
  earlier: readonly AgentPlanStepProgressTodo[],
  reported: readonly AgentPlanStepProgressTodo[],
): readonly AgentPlanStepProgressTodo[] {
  const states = new Map(earlier.map((todo) => [todo.id, todo.status]));
  for (const todo of reported) states.set(todo.id, todo.status);
  return order.flatMap((id) => {
    const status = states.get(id);
    return status ? [{ id, status }] : [];
  });
}

/**
 * Converts a stored row into the progress a view reads.
 *
 * @param stored - The row of one step.
 * @returns The progress, or `null` when the row cannot be read.
 */
export function readStepLiveProgress(
  stored: StoredPlanStepProgress,
): AgentPlanStepLiveProgress | null {
  try {
    return {
      attemptId: stored.attemptId,
      todos: storedTodos(stored),
      activity: stored.activity,
      updatedAt: stored.updatedAt,
    };
  } catch (error: unknown) {
    logCaughtError("AgentPlanStepProgressService", error);
    return null;
  }
}

/**
 * Takes the live progress agents report through `update_step_progress` (PAGE-284).
 *
 * @remarks
 * Like `report_step_result`, the credential alone names the run and the
 * step, and only the attempt whose turn runs may report. A report changes
 * only the progress of that step and ends nothing; it is stored at once, so
 * every open view reads it, and it stays for the next attempt of the run.
 */
export class AgentPlanStepProgressService {
  private readonly reports: Pick<AgentPlanStepReportRepository, "find">;
  private readonly progress: AgentPlanStepProgressRepository;
  private readonly clock: () => string;

  public constructor(dependencies: {
    readonly reports: Pick<AgentPlanStepReportRepository, "find">;
    readonly progress: AgentPlanStepProgressRepository;
    readonly clock?: () => string;
  }) {
    this.reports = dependencies.reports;
    this.progress = dependencies.progress;
    this.clock = dependencies.clock ?? (() => new Date().toISOString());
  }

  /**
   * Checks one call and stores the progress of the running step.
   *
   * @param identity - The verified caller; only a session credential has a run.
   * @param input - The arguments of the tool.
   * @throws {AgentOperationError} With the concrete problems; nothing is stored.
   */
  public async update(
    identity: AgentIdentity,
    input: unknown,
  ): Promise<AgentPlanStepProgressReceipt> {
    if (!identity.run) throw new AgentOperationError("FORBIDDEN");
    const { runId, stepId: sessionScopeId } = identity.run;
    const parsed = callSchema.safeParse(input ?? {});
    if (!parsed.success)
      throw rejection(
        "INVALID_REQUEST",
        "step_report_invalid",
        parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
        ),
      );
    const slot = await this.reports.find({ runId, sessionScopeId });
    if (!slot)
      throw rejection("CONFLICT", "step_report_closed", [
        "No turn of this step is running, so there is no progress to report.",
      ]);
    const order = contractTodoIds(slot.termsJson);
    const unknown = parsed.data.todos.filter(
      (todo) => !order.includes(todo.id),
    );
    if (unknown.length > 0)
      throw rejection(
        "INVALID_REQUEST",
        "step_report_invalid",
        unknown.map(
          (todo) =>
            `todos: ${todo.id} is no todo of this step (${order.join(", ") || "none"})`,
        ),
      );
    const earlier = await this.progress.find(runId, slot.stepId);
    const todos = mergedTodos(order, storedTodos(earlier), parsed.data.todos);
    const activity = parsed.data.activity
      ? sanitizeArtifactText(parsed.data.activity)
      : (earlier?.activity ?? null);
    await this.progress.save({
      runId,
      stepId: slot.stepId,
      attemptId: slot.attemptId,
      todosJson: JSON.stringify(todos),
      activity,
      updatedAt: this.clock(),
    });
    return {
      runId,
      stepId: slot.stepId,
      attemptId: slot.attemptId,
      todos,
      activity,
    };
  }

  /**
   * Reads the live progress of every step of a run.
   *
   * @param runId - A run the caller already authorized.
   * @returns The progress by step ID.
   */
  public async listForRun(
    runId: string,
  ): Promise<ReadonlyMap<string, AgentPlanStepLiveProgress>> {
    const rows = await this.progress.listForRun(runId);
    return new Map(
      rows.flatMap((row) => {
        const progress = readStepLiveProgress(row);
        return progress ? [[row.stepId, progress] as const] : [];
      }),
    );
  }

  /**
   * Reads the live progress of one step.
   *
   * @param runId - A run the caller already authorized.
   * @param stepId - The step.
   */
  public async find(
    runId: string,
    stepId: string,
  ): Promise<AgentPlanStepLiveProgress | null> {
    const row = await this.progress.find(runId, stepId);
    return row ? readStepLiveProgress(row) : null;
  }
}
