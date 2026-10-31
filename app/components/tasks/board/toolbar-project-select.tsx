import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { FILTER_ALL } from "@/app/lib/task-filters";

import type { BoardPreferencesState } from "./use-board-preferences";
import type { Project } from "@/definition/Project";

interface ToolbarProjectSelectProps {
  readonly board: BoardPreferencesState;
  readonly projects: readonly Project[];
}

/** Keeps project selection available while the other filters are closed. */
export function ToolbarProjectSelect({
  board,
  projects,
}: ToolbarProjectSelectProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Select
      ariaLabel={t("tasks.filter.project")}
      value={board.preferences.project}
      onValueChange={(project) => board.update({ project })}
      options={[
        { value: FILTER_ALL, label: t("tasks.filter.allProjects") },
        ...projects.map((project) => ({
          value: project.id,
          label: project.name,
        })),
      ]}
    />
  );
}
