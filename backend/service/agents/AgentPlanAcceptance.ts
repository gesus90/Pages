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
  readonly hasTodos: boolean;
  /** `null` when the report has no criteria list. */
  readonly criteria: ReadonlyMap<
    string,
    { readonly met: boolean | null; readonly evidence: string }
  > | null;
  readonly decisions: readonly string[];
  readonly summary: string;
}

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
  return {
    hasTodos: Array.isArray(report.todos),
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
            {
              met: typeof entry.met === "boolean" ? entry.met : null,
              evidence: shortText(entry.evidence),
            },
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

function ticketState(
  item: AgentPlanContractItem,
  states: AgentPlanTicketStates,
): boolean | null {
  if (item.ticket === null) return null;
  return states.checked.get(`${item.ticket.id}\n${item.ticket.itemId}`) ?? null;
}

function todoStatus(
  todo: AgentPlanContractItem,
  report: PlanReport | null,
  issues: string[],
  states: AgentPlanTicketStates,
): AgentPlanTodoStatus {
  const reported = report?.todos.get(todo.id);
  const status = todoListStatus(todo, report, states);
  if (status !== "done") issues.push(`todo_${status}:${todo.id}`);
  if (reported === "done" && ticketState(todo, states) === false)
    issues.push(`ticket_unchecked:${todo.id}`);
  return { id: todo.id, status };
}

function criterionStatus(
  criterion: AgentPlanContractItem,
  report: PlanReport | null,
  issues: string[],
  states: AgentPlanTicketStates,
): AgentPlanCriterionStatus {
  const reported = report?.criteria?.get(criterion.id);
  const ticketChecked = ticketState(criterion, states);
  if (!reported || reported.met === null)
    issues.push(`criterion_missing:${criterion.id}`);
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
 * Describes business progress independently of the runner's execution result.
 *
 * @param contract - The current todos and criteria, reconciled with the sent report IDs.
 * @param output - The final answer of the agent.
 * @param states - The checklist entries of the bound tickets, read after the turn.
 * @returns Diagnostic progress, including missing reports and open or unproven work.
 *
 * @remarks
 * `accepted` means that this progress assessment has no outstanding issues;
 * `open` preserves every diagnostic. The group runner requires `accepted`;
 * standalone steps keep these findings diagnostic. Ticket todos follow the actual checkbox, including in
 * read-only sessions. Missing or invalid reports never manufacture completion.
 */
export function evaluatePlanAcceptance(
  contract: AgentPlanContract,
  output: string,
  states: AgentPlanTicketStates,
): AgentPlanAcceptance {
  const parsed = readPlanReport(output);
  const report = parsed === "invalid" ? null : parsed;
  const issues: string[] = states.unreadable.map(
    (key) => `ticket_unreadable:${key}`,
  );
  issues.push(...states.changed.map((key) => `ticket_changed:${key}`));
  if (parsed === null) issues.push("report_missing");
  else if (
    parsed === "invalid" ||
    !parsed.hasTodos ||
    (contract.criteria.length > 0 && parsed.criteria === null)
  )
    issues.push("report_invalid");
  const todos = contract.todos.map((todo) =>
    todoStatus(todo, report, issues, states),
  );
  const criteria = contract.criteria.map((criterion) =>
    criterionStatus(criterion, report, issues, states),
  );
  return {
    verdict: issues.length === 0 ? "accepted" : "open",
    todos,
    criteria,
    decisions: report?.decisions ?? [],
    issues,
    summary: report?.summary ?? "",
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
  return checked === false ? "open" : "missing";
}

/**
 * Reports how far the todo list of a node is done, without judging the node.
 *
 * @param contract - The current todo list of the node.
 * @param output - The final answer; an optional report describes unbound todos and decisions.
 * @param states - The checklist entries of the bound tickets, read after the turn.
 * @returns Diagnostic progress without an execution verdict.
 *
 * @remarks
 * A todo with a ticket entry is done exactly when the ticket shows it
 * checked. A todo without one has only the report to go by. A missing or
 * malformed report and changed requirements remain diagnostic issues; an
 * unreadable ticket leaves its todos `missing`, never `done`. No issue gates
 * execution or successor release for standalone steps. Internal group steps
 * require an accepted report under the same group policy as other completion modes.
 */
export function evaluateTodoCompletion(
  contract: AgentPlanContract,
  output: string,
  states: AgentPlanTicketStates,
): AgentPlanAcceptance {
  return evaluatePlanAcceptance(contract, output, states);
}
