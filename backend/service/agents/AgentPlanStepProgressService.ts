import { randomUUID } from "node:crypto";

import { z } from "zod";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanContract } from "@/backend/agents/AgentPlanSessionInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  AGENT_TODO_LIMIT,
  AGENT_TODO_PRIORITIES,
  AGENT_TODO_STATUS_ALIASES,
  AGENT_TODO_STATUSES,
  AGENT_TODO_TEXT_LENGTH,
  mergeAgentTodos,
} from "@/definition/AgentPlanAgentTodos";
import {
  AGENT_STEP_ACTIVITY_LENGTH,
  AGENT_STEP_PROGRESS_STATUS_NAMES,
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
import type {
  AgentPlanAgentTodo,
  AgentPlanEntry,
} from "@/definition/AgentPlanAgentTodos";
import type { AgentTicketChecklistService } from "./AgentTicketChecklistService";

import type {
  AgentPlanStepLiveProgress,
  AgentPlanStepProgressReceipt,
  AgentPlanStepProgressTodo,
} from "@/definition/AgentPlanStepProgress";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type {
  AgentPlanStepReportRepository,
  PlanStepReportSlot,
} from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import type {
  AgentPlanStepProgressRepository,
  StoredPlanStepProgress,
} from "@/backend/database/repositories/agent/AgentPlanStepProgressRepository";

const MAXIMUM_PROBLEMS = 50;

/**
 * The todo that stands for a missing own work list; a completion gate, never agent work.
 * @remarks
 * A correction turn names it among the open todos, so an agent may report it.
 * Only the stored list proves it, so a claim on it changes nothing.
 */
export const WORK_LIST_OBLIGATION_ID = "PAGES_PLAN";

/** The obligation of an attempt that never sent its own work list. */
const MISSING_WORK_LIST =
  "Send your own work list before you report done: call update_step_progress with plan, one concrete entry per work step of this step, every finished entry done.";

/** The hint beside an answer of Pages while the attempt has no own work list yet; it names the tool, because any answer may carry it. */
const MISSING_WORK_LIST_NOTICE =
  "Your own work list is missing. Send it now: call update_step_progress with plan, one concrete entry per work step, every entry open and the current one active; send it again after each finished entry. report_step_result refuses done without it.";

const identifier = z.string().trim().min(1).max(200);
// OpenCode models copy the entry shape of their own task list; its priority says nothing Pages shows, so it is ignored.
const taskPriority = z.enum(AGENT_TODO_PRIORITIES).optional();
const todoSchema = z.strictObject({
  id: identifier,
  status: z
    .enum([...AGENT_STEP_PROGRESS_STATUSES, ...AGENT_TODO_STATUS_ALIASES])
    .transform((status) => AGENT_STEP_PROGRESS_STATUS_NAMES[status]),
  priority: taskPriority,
});
const planEntrySchema = z.strictObject({
  text: z.string().trim().min(1).max(AGENT_TODO_TEXT_LENGTH),
  status: z.enum([...AGENT_TODO_STATUSES, ...AGENT_TODO_STATUS_ALIASES]),
  priority: taskPriority,
});
const callSchema = z
  .strictObject({
    todos: z.array(todoSchema).max(1000),
    plan: z.array(planEntrySchema).min(1).max(AGENT_TODO_LIMIT).optional(),
    activity: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_STEP_ACTIVITY_LENGTH)
      .optional(),
  })
  .refine(
    (report) =>
      report.todos.length > 0 ||
      report.activity !== undefined ||
      report.plan !== undefined,
    {
      path: ["activity"],
      message: "Provide an activity line or a plan when todos is empty.",
    },
  );

/** The ACP name of each state, so an own list merges exactly like a structured CLI plan. */
const ACP_PLAN_STATUS = {
  open: "pending",
  active: "in_progress",
  done: "completed",
  failed: "failed",
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
} as const satisfies Record<z.infer<typeof planEntrySchema>["status"], string>;

function planEntries(
  plan: readonly z.infer<typeof planEntrySchema>[],
): readonly AgentPlanEntry[] {
  return plan.map((entry) => ({
    content: sanitizeArtifactText(entry.text),
    status: ACP_PLAN_STATUS[entry.status],
  }));
}

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

/** Which obligations on the agent's own work list the effective contract carries. */
interface WorkListCheck {
  /** Codex keeps the list in `update_plan` too, so a received list must be complete. */
  readonly checksNativePlan?: boolean;
  /** A report through Pages MCP: the attempt must have sent a list at all. */
  readonly requiresWorkList?: boolean;
}

/**
 * What the agent still owes on its own work list.
 * @param check - The obligations of the caller.
 * @param nativePlan - The stored list of the attempt; `null` before its first list, `undefined` without the repository.
 * @returns The obligation as the agent reads it, or `null` when nothing is owed.
 * @remarks
 * Every session with Pages MCP is told to send its list first. A model that
 * skips it would otherwise report done with no entry in the terminal; the
 * refused report names the missing list, so the agent can still send it.
 */
function workListObligation(
  check: WorkListCheck,
  nativePlan: readonly AgentPlanAgentTodo[] | null | undefined,
): string | null {
  if (check.checksNativePlan && nativePlan != null) {
    if (nativePlan.length === 0)
      return "Complete your work list before continuing: send all entries with the plan field of update_step_progress (or your built-in update_plan tool). The Pages update_plan tool manages agent plans instead.";
    const open = nativePlan.filter((todo) => todo.status !== "done");
    if (open.length > 0)
      return `Complete the open entries of your work list (plan field of update_step_progress or built-in update_plan; Pages update_plan manages agent plans): ${open
        .slice(0, 20)
        .map((todo) => todo.text)
        .join("; ")
        .slice(0, 3000)}`;
  }
  const isListMissing =
    nativePlan === null ||
    (nativePlan !== undefined && nativePlan.length === 0);
  return check.requiresWorkList && isListMissing ? MISSING_WORK_LIST : null;
}

/**
 * Converts a stored row into the progress a view reads.
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
 * Takes the live progress agents report through `update_step_progress`.
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
    | Pick<
        AgentPlanAgentTodoRepository,
        "findPlan" | "findEntries" | "saveReported"
      >
    | undefined;

  public constructor(dependencies: {
    readonly reports: Pick<AgentPlanStepReportRepository, "find">;
    readonly progress: Pick<
      AgentPlanStepProgressRepository,
      "find" | "save" | "listForRun"
    >;
    readonly clock?: () => string;
    readonly tickets?: Pick<AgentTicketChecklistService, "read" | "set">;
    readonly agentTodos?: Pick<
      AgentPlanAgentTodoRepository,
      "findPlan" | "findEntries" | "saveReported"
    >;
  }) {
    this.reports = dependencies.reports;
    this.progress = dependencies.progress;
    this.clock = dependencies.clock ?? (() => new Date().toISOString());
    this.tickets = dependencies.tickets;
    this.agentTodos = dependencies.agentTodos;
  }

  /**
   * Checks one call and stores the progress of the running step.
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
    // Refusing the gate would also drop the list sent with it, the only proof it asks for.
    const reported = parsed.data.todos.filter(
      (todo) => todo.id !== WORK_LIST_OBLIGATION_ID,
    );
    const unknown = reported.filter((todo) => !order.includes(todo.id));
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
    await this.checkTicketTodos(identity, contract, reported);
    const updatedAt = this.clock();
    const ownPlan = await this.saveOwnPlan(slot, parsed.data.plan, updatedAt);
    // The effective contract mirrors the own list; read after the new list is
    // stored, the receipt and the saved state never lag one call behind it.
    const effective = ownPlan.plan
      ? await this.current(
          { runId, stepId: slot.stepId, attemptId: slot.attemptId },
          contractOf(slot.termsJson),
        )
      : contract;
    const states = new Map(
      readTodoState(earlier).todos.map((todo) => [todo.id, todo.status]),
    );
    for (const todo of reported)
      if (states.get(todo.id) !== "done") states.set(todo.id, todo.status);
    const todos = effective.todos.map((todo): AgentPlanStepProgressTodo => ({
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
      todosJson: JSON.stringify({
        ...readTodoState(earlier),
        contract: effective,
        todos,
      }),
      activity,
      updatedAt,
    });
    return {
      runId,
      stepId: slot.stepId,
      attemptId: slot.attemptId,
      todos,
      activity,
      ...ownPlan,
      ...(await this.missingWorkList(slot.attemptId, ownPlan)),
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
    const keepsPreviousState = earlier.scope === scope.iteration && sameTickets;
    let current = contract;
    if (keepsPreviousState) {
      const previous = stored
        ? await this.current(stored, earlier.contract ?? contract)
        : contract;
      current = retainTodoState(contract, { ...earlier, contract: previous });
    }
    const previousStatuses = new Map(
      keepsPreviousState
        ? earlier.todos.map((todo) => [todo.id, todo.status] as const)
        : [],
    );
    await this.progress.save({
      runId: scope.runId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
      activity: keepsPreviousState ? (stored?.activity ?? null) : null,
      updatedAt: keepsPreviousState && stored ? stored.updatedAt : this.clock(),
      todosJson: JSON.stringify({
        scope: scope.iteration,
        contract: current,
        todos: current.todos.map((todo) => ({
          id: todo.id,
          status: todo.checked
            ? "done"
            : (previousStatuses.get(todo.id) ?? "open"),
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
    } & WorkListCheck,
    contract: AgentPlanContract,
  ): Promise<AgentPlanContract> {
    const stored = await this.progress.find(scope.runId, scope.stepId);
    const earlier = readTodoState(stored);
    const isCurrent = stored?.attemptId === scope.attemptId;
    const statuses = new Map(
      isCurrent ? earlier.todos.map((todo) => [todo.id, todo.status]) : [],
    );
    const todos = contract.todos
      .filter((todo) => todo.id !== WORK_LIST_OBLIGATION_ID)
      .map((todo) => ({
        ...todo,
        ...(!todo.ticket && statuses.get(todo.id) === "done"
          ? { checked: true }
          : {}),
      }));
    const nativePlan = await this.agentTodos?.findPlan(scope.attemptId);
    const current = withNativeTodoState(
      { ...contract, todos },
      nativePlan ?? [],
      statuses,
    );
    const obligation = workListObligation(scope, nativePlan);
    if (obligation === null) return current;
    return {
      ...current,
      todos: [
        ...current.todos,
        {
          id: WORK_LIST_OBLIGATION_ID,
          text: obligation,
          ticket: null,
          agent: true,
          checked: false,
        },
      ],
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

  /**
   * Names a missing own work list for a Pages tool call that reports no progress.
   * @param identity - The verified caller; only a session credential has a run.
   * @returns The hint; `undefined` when the attempt has its list or no turn of the step runs.
   * @remarks
   * The list is owed from the first command on. A model that reads tickets or
   * checklists first, or that never calls the progress tool, still reads the
   * hint beside the answer of its first Pages call instead of at the refused
   * closing report.
   */
  public async pendingNotice(
    identity: AgentIdentity,
  ): Promise<string | undefined> {
    if (!identity.run || !this.agentTodos) return undefined;
    const { runId, stepId: sessionScopeId } = identity.run;
    const slot = await this.reports.find({ runId, sessionScopeId });
    if (!slot || !(await this.isWorkListMissing(slot.attemptId)))
      return undefined;
    return MISSING_WORK_LIST_NOTICE;
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

  /** Whether the attempt has stored no own work list, or an empty one. */
  private async isWorkListMissing(attemptId: string): Promise<boolean> {
    const stored = await this.agentTodos?.findPlan(attemptId);
    return stored === null || stored?.length === 0;
  }

  /**
   * Names a missing own work list in the receipt of a call without `plan`.
   * @remarks
   * Models that report only `activity` or the assigned `todos` read the
   * receipt, so the hint brings the list while the work still runs instead of
   * only at the refused closing report.
   */
  private async missingWorkList(
    attemptId: string,
    ownPlan: Pick<AgentPlanStepProgressReceipt, "plan">,
  ): Promise<Pick<AgentPlanStepProgressReceipt, "notice">> {
    if (ownPlan.plan || !this.agentTodos) return {};
    return (await this.isWorkListMissing(attemptId))
      ? { notice: MISSING_WORK_LIST_NOTICE }
      : {};
  }

  /**
   * Replaces the own work list of the running attempt.
   * @returns The stored list for the receipt; empty when the call sent no `plan`.
   * @remarks
   * The list lands where a structured CLI plan of the same attempt lands, so
   * the terminal, the reload and the completion check read one list per
   * attempt; the newest report of either way wins and replays never add
   * entries, because a plan always replaces the whole list. A report that is
   * older than the stored list changes nothing, and the receipt then names
   * the list that stays.
   */
  private async saveOwnPlan(
    slot: Pick<PlanStepReportSlot, "runId" | "stepId" | "attemptId">,
    plan: readonly z.infer<typeof planEntrySchema>[] | undefined,
    updatedAt: string,
  ): Promise<Pick<AgentPlanStepProgressReceipt, "plan">> {
    if (!plan) return {};
    if (!this.agentTodos) throw new AgentOperationError("FORBIDDEN");
    const previous = await this.agentTodos.findEntries(slot.attemptId);
    const merged = mergeAgentTodos(planEntries(plan), previous, updatedAt);
    const isStored = await this.agentTodos.saveReported(
      slot,
      merged,
      updatedAt,
    );
    return { plan: isStored ? merged : previous };
  }
}
