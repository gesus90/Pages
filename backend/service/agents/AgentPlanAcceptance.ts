import { readAgentObject } from "@/backend/agents/AgentPayload";

import { REPORT_EVIDENCE_PLACEHOLDER } from "./AgentPlanContract";
import { sanitizePlanOutput } from "./AgentPlanOutput";

import type {
  AgentPlanAcceptance,
  AgentPlanContract,
  AgentPlanContractItem,
  AgentPlanCriterionStatus,
  AgentPlanTodoStatus,
} from "@/definition/AgentPlanSession";

const REPORT_BLOCK = /```pages-report[^\n]*\n([\s\S]*?)\n```/gu;
const MAXIMUM_REPORT_TEXT = 2_000;
const MAXIMUM_DECISIONS = 20;

/** The closing report as the agent wrote it. */
interface PlanReport {
  readonly todos: ReadonlyMap<string, string>;
  /** `null` when the report has no criteria list, which only a todo list completion accepts. */
  readonly criteria: ReadonlyMap<
    string,
    { readonly met: boolean; readonly evidence: string }
  > | null;
  readonly decisions: readonly string[];
  readonly summary: string;
}

/** A report with the criteria list that a report completion requires. */
type GateReport = PlanReport & {
  readonly criteria: NonNullable<PlanReport["criteria"]>;
};

/** The state of the checklist entries of the bound tickets after the turn. */
export interface AgentPlanTicketStates {
  /** Checked state by `ticketId` and checklist item ID; a missing entry is absent. */
  readonly checked: ReadonlyMap<string, boolean>;
  /** Tickets that could not be read anymore. */
  readonly unreadable: readonly string[];
  /** Tickets whose requirements changed while the node was running. */
  readonly changed: readonly string[];
  /**
   * Whether an entry the report names as done or met must also be checked in
   * the ticket. A read-only session cannot check it; there the report decides.
   */
  readonly isCheckRequired: boolean;
}

function shortText(input: unknown): string {
  return typeof input === "string"
    ? sanitizePlanOutput(input).trim().slice(0, MAXIMUM_REPORT_TEXT)
    : "";
}

function readEntries(input: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(input)
    ? input.map((entry: unknown) => readAgentObject(entry))
    : [];
}

/** Reads the last `pages-report` block of a final answer; anything else is no report. */
function readPlanReport(output: string): PlanReport | "invalid" | null {
  const blocks = [...output.matchAll(REPORT_BLOCK)];
  const last = blocks.at(-1);
  if (!last) return null;
  let report: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(last[1]);
    report = readAgentObject(parsed);
  } catch {
    return "invalid";
  }
  if (!Array.isArray(report.todos)) return "invalid";
  return {
    todos: new Map(
      readEntries(report.todos).map((entry) => [
        shortText(entry.id),
        shortText(entry.status),
      ]),
    ),
    criteria: Array.isArray(report.criteria)
      ? new Map(
          readEntries(report.criteria).map((entry) => [
            shortText(entry.id),
            { met: entry.met === true, evidence: shortText(entry.evidence) },
          ]),
        )
      : null,
    decisions: (Array.isArray(report.decisions) ? report.decisions : [])
      .map(shortText)
      .filter(Boolean)
      .slice(0, MAXIMUM_DECISIONS),
    summary: shortText(report.summary),
  };
}

function readGateReport(output: string): GateReport | "invalid" | null {
  const report = readPlanReport(output);
  if (report === null || report === "invalid") return report;
  const { criteria } = report;
  return criteria === null ? "invalid" : { ...report, criteria };
}

function ticketState(
  item: AgentPlanContractItem,
  states: AgentPlanTicketStates,
): boolean | null {
  if (item.ticket === null) return null;
  return (
    states.checked.get(`${item.ticket.id}\n${item.ticket.itemId}`) ?? false
  );
}

function todoStatus(
  todo: AgentPlanContractItem,
  report: PlanReport,
  issues: string[],
  states: AgentPlanTicketStates,
): AgentPlanTodoStatus {
  const reported = report.todos.get(todo.id);
  const status =
    reported === "done" || reported === "open" ? reported : "missing";
  if (status !== "done") issues.push(`todo_${status}:${todo.id}`);
  if (
    states.isCheckRequired &&
    status === "done" &&
    ticketState(todo, states) === false
  )
    issues.push(`ticket_unchecked:${todo.id}`);
  return { id: todo.id, status };
}

function criterionStatus(
  criterion: AgentPlanContractItem,
  report: GateReport,
  issues: string[],
  states: AgentPlanTicketStates,
): AgentPlanCriterionStatus {
  const reported = report.criteria.get(criterion.id);
  const ticketChecked = ticketState(criterion, states);
  if (!reported) issues.push(`criterion_missing:${criterion.id}`);
  else if (!reported.met) issues.push(`criterion_unmet:${criterion.id}`);
  else if (
    !reported.evidence ||
    reported.evidence === REPORT_EVIDENCE_PLACEHOLDER
  )
    issues.push(`evidence_missing:${criterion.id}`);
  if (states.isCheckRequired && reported?.met && ticketChecked === false)
    issues.push(`ticket_unchecked:${criterion.id}`);
  return {
    id: criterion.id,
    met: reported?.met === true,
    evidence: reported?.evidence ?? "",
    ticketChecked,
  };
}

/**
 * Decides whether a node finished its contract, apart from how its process ended.
 *
 * @param contract - The todos and criteria fixed before the node started.
 * @param output - The final answer of the agent.
 * @param states - The checklist entries of the bound tickets, read after the turn.
 * @returns The verdict with the state of every todo and criterion and the reasons.
 *
 * @remarks
 * Only a valid report that names every todo as done and every criterion as
 * met with evidence is accepted, and every ticket entry among them must be
 * checked in the ticket itself unless the session could not change tickets.
 * An exit code or the end of a turn proves nothing on its own.
 */
export function evaluatePlanAcceptance(
  contract: AgentPlanContract,
  output: string,
  states: AgentPlanTicketStates,
): AgentPlanAcceptance {
  const report = readGateReport(output);
  if (report === null || report === "invalid")
    return {
      verdict: "rejected",
      todos: contract.todos.map((todo) => ({ id: todo.id, status: "missing" })),
      criteria: contract.criteria.map((criterion) => ({
        id: criterion.id,
        met: false,
        evidence: "",
        ticketChecked: ticketState(criterion, states),
      })),
      decisions: [],
      issues: [report === null ? "report_missing" : "report_invalid"],
      summary: "",
    };
  const issues: string[] = states.unreadable.map(
    (key) => `ticket_unreadable:${key}`,
  );
  issues.push(...states.changed.map((key) => `ticket_changed:${key}`));
  const todos = contract.todos.map((todo) =>
    todoStatus(todo, report, issues, states),
  );
  const criteria = contract.criteria.map((criterion) =>
    criterionStatus(criterion, report, issues, states),
  );
  return {
    verdict: issues.length === 0 ? "accepted" : "rejected",
    todos,
    criteria,
    decisions: report.decisions,
    issues,
    summary: report.summary,
  };
}

function todoListStatus(
  todo: AgentPlanContractItem,
  report: PlanReport | null,
  states: AgentPlanTicketStates,
): AgentPlanTodoStatus["status"] {
  const reported = report?.todos.get(todo.id);
  if (todo.ticket === null)
    return reported === "done" || reported === "open" ? reported : "missing";
  const checked = states.checked.get(
    `${todo.ticket.id}\n${todo.ticket.itemId}`,
  );
  if (checked === true) return "done";
  if (checked === undefined) return "missing";
  // A read-only session cannot tick the entry, so its report decides there.
  return !states.isCheckRequired && reported === "done" ? "done" : "open";
}

/**
 * Reports how far the todo list of a node is done, without judging the node.
 *
 * @param contract - The current todo list of the node.
 * @param output - The final answer of the agent; its report only adds a summary and decisions.
 * @param states - The checklist entries of the bound tickets, read after the turn.
 * @returns `accepted` when every todo is done, `open` otherwise; never `rejected`.
 *
 * @remarks
 * A todo with a ticket entry is done exactly when the ticket shows it
 * checked. A todo without one has only the report to go by. A missing or
 * malformed report, changed requirements and other criteria never change the
 * result; an unreadable ticket is listed as an issue and leaves its todos
 * `missing`, never `done`.
 */
export function evaluateTodoCompletion(
  contract: AgentPlanContract,
  output: string,
  states: AgentPlanTicketStates,
): AgentPlanAcceptance {
  const parsed = readPlanReport(output);
  const report = parsed === "invalid" ? null : parsed;
  const todos = contract.todos.map((todo) => ({
    id: todo.id,
    status: todoListStatus(todo, report, states),
  }));
  return {
    verdict: todos.every((todo) => todo.status === "done")
      ? "accepted"
      : "open",
    todos,
    criteria: [],
    decisions: report?.decisions ?? [],
    issues: states.unreadable.map((key) => `ticket_unreadable:${key}`),
    summary: report?.summary ?? "",
  };
}
