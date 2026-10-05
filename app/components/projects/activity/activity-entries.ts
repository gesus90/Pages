import { PROJECT_ACTIVITY_CATEGORY } from "@/definition/Project";

import type {
  ProjectActivity,
  ProjectActivityCategory,
} from "@/definition/Project";
import type { WorkItemHistory } from "@/definition/Task";

/** One line of the activity log, whether it came from the project or a task. */
export interface ActivityEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly category: ProjectActivityCategory;
  readonly userName: string | null;
  readonly message: string;
}

/** The filter value that lets every category or person through. */
export const ALL_ACTIVITIES = "all";

/** Which entries the activity log shows. */
export interface ActivityFilter {
  readonly category: typeof ALL_ACTIVITIES | ProjectActivityCategory;
  readonly person: string;
}

function toTaskMessage(action: string, field: string | null): string {
  if (action === "created") {
    return "hat eine Aufgabe erstellt.";
  }

  if (action === "archived") {
    return "hat eine Aufgabe archiviert.";
  }

  if (action === "status_changed") {
    return "hat den Aufgabenstatus geändert.";
  }

  if (field) {
    return `hat eine Aufgabe geändert (${field}).`;
  }

  return "hat eine Aufgabe geändert.";
}

/**
 * Merges the project activity and the task history into one log, newest first.
 *
 * @param activity - Entries written for the project itself.
 * @param taskHistory - Changes of the project's tasks.
 */
export function buildActivityEntries(
  activity: readonly ProjectActivity[],
  taskHistory: readonly WorkItemHistory[],
): ActivityEntry[] {
  const projectEntries: ActivityEntry[] = activity.map((entry) => ({
    category: entry.category,
    createdAt: entry.createdAt,
    id: entry.id,
    message: entry.message,
    userName: entry.userDisplayName,
  }));
  const taskEntries: ActivityEntry[] = taskHistory.map((entry) => ({
    category: PROJECT_ACTIVITY_CATEGORY.TASKS,
    createdAt: entry.createdAt,
    id: `task-${entry.id}`,
    message: toTaskMessage(entry.action, entry.field),
    userName: entry.userDisplayName,
  }));

  return [...projectEntries, ...taskEntries].sort((first, second) =>
    first.createdAt < second.createdAt ? 1 : -1,
  );
}

/** Lists the people who appear in the log, sorted by name. */
export function listActivityPeople(
  entries: readonly ActivityEntry[],
): string[] {
  const names = new Set<string>();

  for (const entry of entries) {
    if (entry.userName) {
      names.add(entry.userName);
    }
  }

  return [...names].sort((first, second) => first.localeCompare(second));
}

/** Keeps the entries that match the chosen category and person. */
export function filterActivityEntries(
  entries: readonly ActivityEntry[],
  filter: ActivityFilter,
): ActivityEntry[] {
  return entries.filter((entry) => {
    const matchesCategory =
      filter.category === ALL_ACTIVITIES || entry.category === filter.category;
    const matchesPerson =
      filter.person === ALL_ACTIVITIES || entry.userName === filter.person;

    return matchesCategory && matchesPerson;
  });
}
