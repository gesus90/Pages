import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { PROJECT_ACTIVITY_CATEGORY } from "@/definition/Project";

import type {
  ProjectActivity,
  ProjectActivityCategory,
} from "@/definition/Project";
import type { WorkItemHistory } from "@/definition/Task";

interface ProjectActivityTabProps {
  readonly activity: readonly ProjectActivity[];
  readonly taskHistory: readonly WorkItemHistory[];
}

interface ActivityEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly category: ProjectActivityCategory;
  readonly userName: string | null;
  readonly message: string;
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

/** Renders the chronological project activity log with category and person filters. */
export function ProjectActivityTab({
  activity,
  taskHistory,
}: ProjectActivityTabProps): React.ReactElement {
  const { t } = useTranslation();
  const [category, setCategory] = useState<"all" | ProjectActivityCategory>(
    "all",
  );
  const [person, setPerson] = useState<string>("all");

  const entries = useMemo<readonly ActivityEntry[]>(() => {
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
  }, [activity, taskHistory]);

  const people = useMemo<readonly string[]>(() => {
    const names = new Set<string>();

    for (const entry of entries) {
      if (entry.userName) {
        names.add(entry.userName);
      }
    }

    return [...names].sort((first, second) => first.localeCompare(second));
  }, [entries]);

  const visibleEntries = entries.filter((entry) => {
    const matchesCategory = category === "all" || entry.category === category;
    const matchesPerson = person === "all" || entry.userName === person;

    return matchesCategory && matchesPerson;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="sr-only">
            {t("projectDetail.activity.allActivities")}
          </span>
          <Select
            ariaLabel={t("projectDetail.activity.allActivities")}
            value={category}
            onValueChange={(value) =>
              setCategory(value as "all" | ProjectActivityCategory)
            }
            className="w-full"
            options={[
              {
                value: "all",
                label: t("projectDetail.activity.allActivities"),
              },
              ...Object.values(PROJECT_ACTIVITY_CATEGORY).map((option) => ({
                value: option,
                label: t(`projectDetail.activity.${option}`),
              })),
            ]}
          />
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="sr-only">
            {t("projectDetail.activity.allPeople")}
          </span>
          <Select
            ariaLabel={t("projectDetail.activity.allPeople")}
            value={person}
            onValueChange={setPerson}
            className="w-full"
            options={[
              { value: "all", label: t("projectDetail.activity.allPeople") },
              ...people.map((name) => ({ value: name, label: name })),
            ]}
          />
        </label>
      </div>

      {visibleEntries.length ? (
        <ul className="flex flex-col gap-2">
          {visibleEntries.map((entry) => (
            <li
              key={entry.id}
              className="flex gap-4 rounded-xl bg-surface px-4 py-3 text-sm shadow-card"
            >
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                {entry.createdAt}
              </span>
              <span className="min-w-0">
                {entry.userName ? (
                  <span className="font-medium text-foreground">
                    {entry.userName}{" "}
                  </span>
                ) : null}
                <span className="text-muted-foreground">{entry.message}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(`projectDetail.activity.${entry.category}`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("projectDetail.activity.empty")}
        </p>
      )}
    </div>
  );
}
