import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import type { Department } from "@/definition/Authorization";

interface ProjectDepartmentChoicesProps {
  readonly available: readonly Department[];
  readonly selected: readonly string[];
  readonly selectionRequired: boolean;
  readonly onChange: (departmentIds: string[]) => void;
}

/** Provides the required multiple selection and keeps its last assignment checked. */
export function ProjectDepartmentChoices({
  available,
  selected,
  selectionRequired,
  onChange,
}: ProjectDepartmentChoicesProps): React.ReactElement {
  const { t } = useTranslation();
  const hintId = useId();
  const emptyHint = t(
    selectionRequired
      ? "projects.departments.noAvailable"
      : "projects.departments.emptyCatalog",
  );
  const hint =
    available.length > 0 ? t("projects.departments.lastRequired") : emptyHint;

  function handleToggle(departmentId: string): void {
    onChange(
      selected.includes(departmentId)
        ? selected.filter((id) => id !== departmentId)
        : [...selected, departmentId],
    );
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={hintId}>
      <legend className="mb-1.5 text-sm font-medium">
        {t(
          selectionRequired
            ? "projects.departments.requiredLabel"
            : "projects.departments.label",
        )}
      </legend>
      {selected.map((id) => (
        <input key={id} type="hidden" name="departmentIds" value={id} />
      ))}
      <VerticalScrollArea
        className="max-h-48 [--scroll-fade-channels:var(--surface-channels)]"
        contentClassName="flex flex-col gap-2 px-1 pt-1 pb-10"
      >
        {available.map((department) => {
          const isSelected = selected.includes(department.id);
          return (
            <label
              key={department.id}
              className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm hover:bg-muted/40 xl:min-h-9"
            >
              <Checkbox
                checked={isSelected}
                disabled={
                  selectionRequired && isSelected && selected.length === 1
                }
                onChange={() => handleToggle(department.id)}
              />
              <span className="min-w-0 break-words">{department.name}</span>
            </label>
          );
        })}
      </VerticalScrollArea>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </fieldset>
  );
}
