import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { WorkItemHistory, WorkItemVisibility } from "@/definition/Task";

/** Redacts system-generated parent references using the same current ticket scope as the history. */
export async function visibleTaskHistory(
  repository: TaskRepository,
  entries: WorkItemHistory[],
  visibility: WorkItemVisibility,
): Promise<WorkItemHistory[]> {
  const keys = entries
    .filter((entry) => entry.field === "parent")
    .flatMap((entry) => [entry.oldValue, entry.newValue])
    .filter((key): key is string => key !== null);
  if (keys.length === 0) return entries;
  const visibleKeys = await repository.findVisibleKeys(
    [...new Set(keys)],
    visibility,
  );
  return entries.map((entry) =>
    entry.field === "parent"
      ? {
          ...entry,
          oldValue:
            entry.oldValue !== null && visibleKeys.has(entry.oldValue)
              ? entry.oldValue
              : null,
          newValue:
            entry.newValue !== null && visibleKeys.has(entry.newValue)
              ? entry.newValue
              : null,
        }
      : entry,
  );
}
