import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";
import type { AgentPlanContractItem } from "@/definition/AgentPlanSession";

/** The obligation Pages adds while the agent's own work list is missing; a completion gate, not agent work. */
const WORK_LIST_OBLIGATION_ID = "PAGES_PLAN";

/** Step states in which the session no longer works on an entry it left in progress. */
const INTERRUPTED_STEP_STATUSES: ReadonlySet<AgentPlanStepResult["status"]> =
  new Set(["failed", "cancelled", "paused"]);

/** One listed entry; an interrupted entry keeps the failure mark but says why. */
export interface StepTodo extends AgentPlanProgressItem {
  readonly isInterrupted?: boolean;
}

/** The TODO list of one node result, the same in the run bar, its details and the terminal. */
export interface StepTodoList {
  readonly todos: readonly StepTodo[];
  readonly done: number;
  readonly total: number;
  /** The entry reported in progress; never the first open one. */
  readonly current: StepTodo | null;
  /**
   * Where the entries come from: the agent's own list of the current attempt,
   * the assignment of the node, or nothing yet.
   */
  readonly source: "agent" | "assignment" | "none";
}

/** The attempt the node runs now; `null` for a result without a session or execution. */
function currentAttemptId(step: AgentPlanStepResult): string | null {
  if (step.session) return sessionAttemptId(step.session, step.id);
  return step.execution?.attemptId ?? null;
}

/** The agent's own list of the attempt the node runs now; a list of an earlier attempt never counts. */
function currentAgentTodos(
  step: AgentPlanStepResult,
): AgentPlanStepResult["agentTodos"] | null {
  const list = step.agentTodos;
  if (!list) return null;
  const attemptId = currentAttemptId(step);
  if (attemptId !== null && attemptId !== list.attemptId) return null;
  return list;
}

/** The live todo states of the current attempt; an observation of another attempt is left out. */
function currentProgressTodos(
  step: AgentPlanStepResult,
): readonly AgentPlanProgressItem[] {
  const progress = step.progress;
  if (!progress) return [];
  const observed = progress.scope?.attemptId ?? null;
  const attemptId = currentAttemptId(step);
  if (observed !== null && attemptId !== null && attemptId !== observed)
    return [];
  return progress.todos;
}

/** The contract entries as listed entries, with their kept completion. */
function contractEntries(
  items: readonly AgentPlanContractItem[],
): readonly AgentPlanProgressItem[] {
  return items.map((item): AgentPlanProgressItem => ({
    id: item.id,
    contractId: item.id,
    text: item.text,
    status: item.checked ? "done" : "open",
  }));
}

/**
 * The entries of the assignment: the live todos, else the contract todos, else its criteria.
 * @remarks
 * The live todos hold the task lines of the instruction and the checklist of
 * the bound tickets, so a ticket node lists its work before the agent sends
 * its own list.
 */
function assignedTodos(
  step: AgentPlanStepResult,
): readonly AgentPlanProgressItem[] {
  const progress = currentProgressTodos(step);
  if (progress.length > 0) return progress;
  const contract = step.session?.contract;
  if (contract && contract.todos.length > 0)
    return contractEntries(contract.todos);
  if (contract && contract.criteria.length > 0)
    return contractEntries(contract.criteria);
  return [];
}

/**
 * Marks the entries an ended attempt left in progress as interrupted.
 * @remarks
 * A failed, cancelled or paused step works on nothing any more, so an entry
 * still in progress would claim live work that no longer happens.
 */
function withInterruptions(
  step: AgentPlanStepResult,
  todos: readonly AgentPlanProgressItem[],
): readonly StepTodo[] {
  if (!INTERRUPTED_STEP_STATUSES.has(step.status)) return todos;
  return todos.map((todo): StepTodo =>
    todo.status === "active"
      ? { ...todo, status: "failed", isInterrupted: true }
      : todo,
  );
}

/** Keeps the first entry of every ID, so a repeated entry is listed and counted once. */
function uniqueTodos(todos: readonly StepTodo[]): readonly StepTodo[] {
  const seen = new Set<string>();
  return todos.filter((todo) => {
    if (todo.id === WORK_LIST_OBLIGATION_ID || seen.has(todo.id)) return false;
    seen.add(todo.id);
    return true;
  });
}

function listOf(
  todos: readonly StepTodo[],
  source: StepTodoList["source"],
): StepTodoList {
  return {
    todos,
    done: todos.filter((todo) => todo.status === "done").length,
    total: todos.length,
    current: todos.find((todo) => todo.status === "active") ?? null,
    source: todos.length > 0 ? source : "none",
  };
}

/**
 * The TODO list of one node result, as the run bar, its details and the terminal show it.
 * @param step - The node result of the selected or running step.
 * @remarks
 * The agent's own list of the current attempt comes first. Until it arrives,
 * the entries of the assignment stand instead. Without either the list is
 * empty; the name of the node stays its heading and never becomes an entry.
 * Every view reads this one list, so they always report the same state.
 */
export function stepTodoList(
  step: AgentPlanStepResult | undefined,
): StepTodoList {
  if (!step) return listOf([], "none");
  const own = currentAgentTodos(step)?.todos ?? [];
  if (own.length > 0)
    return listOf(uniqueTodos(withInterruptions(step, own)), "agent");
  return listOf(
    uniqueTodos(withInterruptions(step, assignedTodos(step))),
    "assignment",
  );
}

/**
 * The newest moment the agent of a node reported its work.
 * @param step - The node result.
 * @returns The time as ISO 8601, or `null` before the first report.
 * @remarks
 * Counts an activity line or todo states of `update_step_progress`, the own
 * list of the current attempt and a structured ACP plan. Antigravity sends no
 * ACP plan, so the first two are its only reports.
 */
export function stepReportedAt(step: AgentPlanStepResult): string | null {
  const times = [
    step.progress?.activity?.reportedAt,
    currentAgentTodos(step)?.updatedAt,
    step.session?.activity?.reportedAt,
  ].filter((time): time is string => Number.isFinite(Date.parse(time ?? "")));
  times.sort((first, second) => Date.parse(second) - Date.parse(first));
  return times[0] ?? null;
}
