import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { PROJECT_ACTIVITY_CATEGORY } from "@/definition/Project";

import { ALL_ACTIVITIES } from "./activity-entries";

import type { ActivityFilter } from "./activity-entries";

interface ActivityFiltersProps {
  readonly filter: ActivityFilter;
  readonly people: readonly string[];
  readonly onFilterChange: (filter: ActivityFilter) => void;
}

/** The category and person selects above the activity log. */
export function ActivityFilters({
  filter,
  people,
  onFilterChange,
}: ActivityFiltersProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="sr-only">
          {t("projectDetail.activity.allActivities")}
        </span>
        <Select
          ariaLabel={t("projectDetail.activity.allActivities")}
          value={filter.category}
          onValueChange={(category) => onFilterChange({ ...filter, category })}
          className="w-full"
          options={[
            {
              value: ALL_ACTIVITIES,
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
        <span className="sr-only">{t("projectDetail.activity.allPeople")}</span>
        <Select
          ariaLabel={t("projectDetail.activity.allPeople")}
          value={filter.person}
          onValueChange={(person) => onFilterChange({ ...filter, person })}
          className="w-full"
          options={[
            {
              value: ALL_ACTIVITIES,
              label: t("projectDetail.activity.allPeople"),
            },
            ...people.map((name) => ({ value: name, label: name })),
          ]}
        />
      </label>
    </div>
  );
}
