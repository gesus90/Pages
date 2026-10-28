import type { AgentPlanPhase, AgentPlanTask } from "@/definition/AgentPlan";

/** The phases of a synthetic workflow: open, ongoing, in review and finished. */
export const PHASES: readonly AgentPlanPhase[] = [
  { key: "todo", name: "To Do", isDone: false },
  { key: "in_progress", name: "In Progress", isDone: false },
  { key: "review", name: "Review", isDone: false },
  { key: "done", name: "Done", isDone: true },
];

/** An open task `SYN-<id>`; `overrides` change single fields. */
export function ticket(
  id: string,
  overrides: Partial<AgentPlanTask> = {},
): AgentPlanTask {
  return {
    id,
    key: `SYN-${id}`,
    title: `Ticket ${id}`,
    type: "task",
    parentId: null,
    statusKey: "todo",
    statusName: "To Do",
    isDone: false,
    createdAt: "2026-01-01 08:00:00",
    updatedAt: "2026-01-02 09:00:00",
    ...overrides,
  };
}
