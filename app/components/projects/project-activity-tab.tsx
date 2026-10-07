import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";

import { ActivityFilters } from "./activity/activity-filters";
import {
  ALL_ACTIVITIES,
  buildActivityEntries,
  filterActivityEntries,
  listActivityPeople,
} from "./activity/activity-entries";

import type { ProjectActivity } from "@/definition/Project";
import type { WorkItemHistory } from "@/definition/Task";
import type { ActivityFilter } from "./activity/activity-entries";

interface ProjectActivityTabProps {
  readonly activity: readonly ProjectActivity[];
  readonly taskHistory: readonly WorkItemHistory[];
}

/** Renders the chronological project activity log with category and person filters. */
export function ProjectActivityTab({
  activity,
  taskHistory,
}: ProjectActivityTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const [filter, setFilter] = useState<ActivityFilter>({
    category: ALL_ACTIVITIES,
    person: ALL_ACTIVITIES,
  });

  const entries = buildActivityEntries(activity, taskHistory);
  const visibleEntries = filterActivityEntries(entries, filter);

  return (
    <div className="flex flex-col gap-4">
      <ActivityFilters
        filter={filter}
        onFilterChange={setFilter}
        people={listActivityPeople(entries)}
      />

      {visibleEntries.length ? (
        <ul className="flex flex-col gap-2">
          {visibleEntries.map((entry) => (
            <li
              key={entry.id}
              className="flex gap-4 rounded-xl bg-surface px-4 py-3 text-sm shadow-card"
            >
              <span className="w-32 shrink-0 text-xs text-muted-foreground">
                {formatDateTime(entry.createdAt)}
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
