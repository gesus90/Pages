import { useTranslation } from "react-i18next";

import type { Department } from "@/definition/Authorization";

interface ProjectDepartmentChipsProps {
  readonly departments: readonly Department[];
}

/** Shows a project's shared department assignments, including the initial empty state. */
export function ProjectDepartmentChips({
  departments,
}: ProjectDepartmentChipsProps): React.ReactElement {
  const { t } = useTranslation();
  if (departments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("projects.departments.none")}
      </p>
    );
  }
  return (
    <ul
      className="flex flex-wrap gap-1.5"
      aria-label={t("projects.departments.label")}
    >
      {departments.map((department) => (
        <li
          key={department.id}
          className="inline-flex max-w-full items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          <span className="truncate">{department.name}</span>
        </li>
      ))}
    </ul>
  );
}
