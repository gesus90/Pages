import { parseInstant } from "@/app/lib/region-format";
import { WORKFLOW_STATUS_KEY } from "@/definition/Task";

import type { AgentPlanPhase, AgentPlanTask } from "@/definition/AgentPlan";

/** The orders the ticket choice offers; `updated` is the default. */
export const TICKET_SORTS = ["title", "created", "updated"] as const;
export type TicketSort = (typeof TICKET_SORTS)[number];
export type TicketDirection = "asc" | "desc";

/** Search text, phase filter and order of the ticket choice, applied together. */
export interface TicketQuery {
  readonly text: string;
  /** Status keys of the chosen phases; empty means every phase. */
  readonly phases: readonly string[];
  readonly sort: TicketSort;
  readonly direction: TicketDirection;
}

/** The first view: every phase, last changed first. */
export const DEFAULT_TICKET_QUERY: TicketQuery = {
  text: "",
  phases: [],
  sort: "updated",
  direction: "desc",
};

/** The color family of a phase badge. */
export type PhaseTone = "neutral" | "progress" | "review" | "done";

function searchTerms(text: string): readonly string[] {
  return text.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

function matchesTerms(task: AgentPlanTask, terms: readonly string[]): boolean {
  const text = `${task.key} ${task.title}`.toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

/** The instant of the time the order uses, or `null` when it is missing or unreadable. */
function sortInstant(task: AgentPlanTask, sort: TicketSort): number | null {
  const value = sort === "created" ? task.createdAt : task.updatedAt;
  return value ? (parseInstant(value)?.getTime() ?? null) : null;
}

function compareInstants(
  left: number | null,
  right: number | null,
  direction: TicketDirection,
): number {
  // Tickets without a readable time end the list in both directions.
  if (left === null || right === null)
    return Number(left === null) - Number(right === null);
  return direction === "asc" ? left - right : right - left;
}

function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareTickets(
  left: AgentPlanTask,
  right: AgentPlanTask,
  query: TicketQuery,
  collator: Intl.Collator,
): number {
  let order = 0;
  if (query.sort === "title") {
    order = collator.compare(left.title, right.title);
    if (query.direction === "desc") order = -order;
  } else
    order = compareInstants(
      sortInstant(left, query.sort),
      sortInstant(right, query.sort),
      query.direction,
    );
  // Equal values keep one stable order: the public key, then the identifier.
  return (
    order ||
    collator.compare(left.key, right.key) ||
    compareIds(left.id, right.id)
  );
}

/**
 * Applies search text, phase filter and order to the whole ticket list.
 *
 * @param tasks - Every ticket the plan may reference, as the server lists them.
 * @param query - Search text, phases and order; phases combine with OR, the
 * search text with AND.
 * @param collator - Compares titles and keys in the language of the page.
 * @returns The matching tickets in order.
 */
export function findTickets(
  tasks: readonly AgentPlanTask[],
  query: TicketQuery,
  collator: Intl.Collator,
): readonly AgentPlanTask[] {
  const terms = searchTerms(query.text);
  return tasks
    .filter(
      (task) =>
        (query.phases.length === 0 || query.phases.includes(task.statusKey)) &&
        matchesTerms(task, terms),
    )
    .sort((left, right) => compareTickets(left, right, query, collator));
}

/** Whether the search or the phase filter hides tickets. */
export function isFilteredTicketQuery(query: TicketQuery): boolean {
  return searchTerms(query.text).length > 0 || query.phases.length > 0;
}

/**
 * The badge color of a workflow phase.
 *
 * @remarks
 * Phases come from the project's workflow; the known keys keep their board
 * meaning, a finishing phase is done, and every other phase stays neutral.
 */
export function phaseTone(
  phase: Pick<AgentPlanPhase, "key" | "isDone">,
): PhaseTone {
  if (phase.isDone) return "done";
  if (phase.key === WORKFLOW_STATUS_KEY.IN_PROGRESS) return "progress";
  if (phase.key === WORKFLOW_STATUS_KEY.REVIEW) return "review";
  return "neutral";
}
