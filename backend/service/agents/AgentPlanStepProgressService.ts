import { randomUUID } from "node:crypto";

import { z } from "zod";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanContract } from "@/backend/agents/AgentPlanSessionInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  AGENT_STEP_ACTIVITY_LENGTH,
  AGENT_STEP_PROGRESS_STATUSES,
} from "@/definition/AgentPlanStepProgress";

import {
  readTodoState,
  retainTodoState,
  withNativeTodoState,
} from "./AgentPlanTodoState";

import { sanitizeArtifactText } from "./AgentPlanOutput";

import type {
  AgentPlanContract,
  AgentPlanContractItem,
} from "@/definition/AgentPlanSession";
import type { AgentPlanAgentTodoRepository } from "@/backend/database/repositories/agent/AgentPlanAgentTodoRepository";
import type { AgentTicketChecklistService } from "./AgentTicketChecklistService";

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

function contractOf(termsJson: string): AgentPlanContract {
  const terms = readAgentObject(JSON.parse(termsJson));
  const contract = readPlanContract(terms.contract);
  if (!contract) throw new Error("Invalid step report terms");
  return contract;
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
      todos: readTodoState(stored).todos,
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
  private readonly progress: Pick<
    AgentPlanStepProgressRepository,
    "find" | "save" | "listForRun"
  >;
  private readonly clock: () => string;
  private readonly tickets:
    Pick<AgentTicketChecklistService, "read" | "set"> | undefined;
  private readonly agentTodos:
    Pick<AgentPlanAgentTodoRepository, "findEntries"> | undefined;

  public constructor(dependencies: {
    readonly reports: Pick<AgentPlanStepReportRepository, "find">;
    readonly progress: Pick<
      AgentPlanStepProgressRepository,
      "find" | "save" | "listForRun"
    >;
    readonly clock?: () => string;
    readonly tickets?: Pick<AgentTicketChecklistService, "read" | "set">;
    readonly agentTodos?: Pick<AgentPlanAgentTodoRepository, "findEntries">;
  }) {
    this.reports = dependencies.reports;
    this.progress = dependencies.progress;
    this.clock = dependencies.clock ?? (() => new Date().toISOString());
    this.tickets = dependencies.tickets;
    this.agentTodos = dependencies.agentTodos;
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
    const contract = await this.current(
      { runId, stepId: slot.stepId, attemptId: slot.attemptId },
      contractOf(slot.termsJson),
    );
    const order = contract.todos.map((todo) => todo.id);
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
    await this.checkTicketTodos(identity, contract, parsed.data.todos);
    const states = new Map(
      readTodoState(earlier).todos.map((todo) => [todo.id, todo.status]),
    );
    for (const todo of parsed.data.todos)
      if (states.get(todo.id) !== "done") states.set(todo.id, todo.status);
    const todos = contract.todos.map((todo): AgentPlanStepProgressTodo => ({
      id: todo.id,
      status: todo.checked ? "done" : (states.get(todo.id) ?? "open"),
    }));
    const activity = parsed.data.activity
      ? sanitizeArtifactText(parsed.data.activity)
      : (earlier?.activity ?? null);
    await this.progress.save({
      runId,
      stepId: slot.stepId,
      attemptId: slot.attemptId,
      todosJson: JSON.stringify({ ...readTodoState(earlier), contract, todos }),
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

  /** Starts an attempt from its own iteration's work, retaining completed entries across resumes. */
  public async initialize(
    scope: {
      readonly runId: string;
      readonly stepId: string;
      readonly attemptId: string;
      readonly iteration: string;
      readonly sourceRunId?: string;
    },
    contract: AgentPlanContract,
  ): Promise<AgentPlanContract> {
    const stored =
      (await this.progress.find(scope.runId, scope.stepId)) ??
      (scope.sourceRunId
        ? await this.progress.find(scope.sourceRunId, scope.stepId)
        : null);
    const earlier = readTodoState(stored);
    const sameTickets =
      JSON.stringify(earlier.contract?.tickets.map((ticket) => ticket.id)) ===
      JSON.stringify(contract.tickets.map((ticket) => ticket.id));
    let current = contract;
    if (earlier.scope === scope.iteration && sameTickets) {
      const previous = stored
        ? await this.current(stored, earlier.contract ?? contract)
        : contract;
      current = retainTodoState(contract, { ...earlier, contract: previous });
    }
    await this.progress.save({
      runId: scope.runId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
      activity: null,
      updatedAt: this.clock(),
      todosJson: JSON.stringify({
        scope: scope.iteration,
        contract: current,
        todos: current.todos.map((todo) => ({
          id: todo.id,
          status: todo.checked ? "done" : "open",
        })),
      }),
    });
    return current;
  }

  /** Returns the effective contract, including persistent completion and structured agent plans. */
  public async current(
    scope: {
      readonly runId: string;
      readonly stepId: string;
      readonly attemptId: string;
    },
    contract: AgentPlanContract,
  ): Promise<AgentPlanContract> {
    const stored = await this.progress.find(scope.runId, scope.stepId);
    const earlier = readTodoState(stored);
    const isCurrent = stored?.attemptId === scope.attemptId;
    const statuses = new Map(
      isCurrent ? earlier.todos.map((todo) => [todo.id, todo.status]) : [],
    );
    const todos = contract.todos.map((todo) => ({
      ...todo,
      ...(!todo.ticket && statuses.get(todo.id) === "done"
        ? { checked: true }
        : {}),
    }));
    const native = (await this.agentTodos?.findEntries(scope.attemptId)) ?? [];
    return withNativeTodoState({ ...contract, todos }, native, statuses);
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
  private async checkTicketTodos(
    identity: AgentIdentity,
    contract: AgentPlanContract,
    reported: readonly AgentPlanStepProgressTodo[],
  ): Promise<void> {
    for (const todo of reported) {
      const ticket = contract.todos.find(
        (entry) => entry.id === todo.id,
      )?.ticket;
      if (!ticket || todo.status !== "done" || identity.run?.reach === "read")
        continue;
      await this.checkTicketTodo(identity, ticket);
    }
  }

  private async checkTicketTodo(
    identity: AgentIdentity,
    ticket: NonNullable<AgentPlanContractItem["ticket"]>,
  ): Promise<void> {
    if (!this.tickets) throw new AgentOperationError("FORBIDDEN");
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.tickets.read(identity, {
        ticketId: ticket.id,
      });
      const checklist = readAgentObject(response.result);
      try {
        await this.tickets.set(identity, {
          ticketId: ticket.id,
          itemId: ticket.itemId,
          checked: true,
          expectedRevision: checklist.revision,
          operationId: randomUUID(),
        });
        return;
      } catch (error: unknown) {
        if (
          !(error instanceof AgentOperationError) ||
          error.code !== "CONFLICT" ||
          attempt >= 2
        )
          throw error;
      }
    }
  }
}
