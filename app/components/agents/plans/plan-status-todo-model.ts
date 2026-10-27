import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanProgress,
  AgentPlanProgressItem,
} from "@/definition/AgentPlanProgress";

/** Observed checklist counts for one selected node, separate from technical plan steps. */
export interface PlanTodoSummary {
  readonly items: readonly AgentPlanProgressItem[];
  readonly completed: number;
  readonly active: number;
  readonly open: number;
  readonly total: number;
  readonly isConfirmed: boolean;
  readonly tickets: readonly string[];
}

function isChecklistObserved(
  progress: AgentPlanProgress | undefined,
  items: readonly AgentPlanProgressItem[],
): boolean {
  if (progress?.availability !== "observed") return false;
  return items.every(
    (item) => item.status !== "missing" && item.status !== "unreported",
  );
}

/** Counts only stable ticket checklist entries, never prompt placeholders or console output. */
export function planTodoSummary(
  step: AgentPlanStepResult | undefined,
): PlanTodoSummary {
  const progress = step?.progress;
  const tickets = progress?.tickets ?? step?.session?.contract?.tickets ?? [];
  const items = (progress?.todos ?? []).filter(
    (item) =>
      item.ticket !== undefined ||
      tickets.some((ticket) => item.id.startsWith(`${ticket.id}:`)),
  );
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  const completed = unique.filter((item) => item.status === "done").length;
  const active = unique.filter((item) => item.status === "active").length;
  return {
    items: unique,
    completed,
    active,
    open: unique.length - completed - active,
    total: unique.length,
    isConfirmed: tickets.length > 0 && isChecklistObserved(progress, unique),
    tickets: [...new Set(tickets.map((ticket) => ticket.key))],
  };
}
