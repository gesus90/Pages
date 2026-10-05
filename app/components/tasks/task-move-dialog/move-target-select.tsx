import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { Project } from "@/definition/Project";

interface MoveTargetSelectProps {
  readonly projects: readonly Project[];
  readonly currentProjectId: string;
  readonly value: string;
  readonly onChange: (projectId: string) => void;
}

/** Renders the labelled select that picks the project to move a ticket to. */
export function MoveTargetSelect({
  projects,
  currentProjectId,
  value,
  onChange,
}: MoveTargetSelectProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4">
      <span
        className="block select-none text-sm font-medium text-foreground"
        id="task-move-target"
      >
        {t("tasks.move.target")}
      </span>
      <Select
        ariaLabel={t("tasks.move.target")}
        value={value}
        onValueChange={onChange}
        className="mt-1 w-full"
        options={[
          { value: "", label: t("tasks.move.choose") },
          ...projects
            .filter((project) => project.id !== currentProjectId)
            .map((project) => ({
              value: project.id,
              label: project.name,
            })),
        ]}
      />
    </div>
  );
}
