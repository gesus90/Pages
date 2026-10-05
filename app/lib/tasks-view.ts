/** The ways the task page can show the work items. */
export const TASKS_VIEW_MODES = [
  "kanban",
  "list",
  "hierarchy",
  "milestones",
  "github",
] as const;

/** One of the task views. */
export type TasksViewMode = (typeof TASKS_VIEW_MODES)[number];

/** Which tickets the archive filter lets through. */
export type ArchivedFilter = "active" | "archived" | "all";
