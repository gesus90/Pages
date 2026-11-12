import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { Department } from "@/definition/Authorization";

interface TicketDepartmentChipsProps {
  /** Departments the ticket carries now; empty means visible to the whole project. */
  readonly selectedIds: readonly string[];
  /** Every department, to name the selected ones. */
  readonly known: readonly Department[];
  /** Departments the visitor may add or remove. */
  readonly selectable: readonly Department[];
  readonly disabled?: boolean;
  /** Asks before the last department goes, because that opens the ticket to the whole project. */
  readonly shouldConfirmClear?: boolean;
  readonly onChange: (departmentIds: string[]) => void;
}

/**
 * Shows the departments of a ticket as chips with a picker to add more.
 *
 * @remarks
 * Without a department the chip "Ohne Abteilung" and a hint name the effect.
 * The server decides every change again; the controls only mirror its rules:
 * own and administered departments are added and removed freely, a foreign
 * department only goes when it is the last one.
 */
export function TicketDepartmentChips({
  selectedIds,
  known,
  selectable,
  disabled = false,
  shouldConfirmClear = false,
  onChange,
}: TicketDepartmentChipsProps): React.ReactElement {
  const { t } = useTranslation();
  const nameOf = (id: string): string =>
    known.find((department) => department.id === id)?.name ?? id;
  const addable = selectable.filter(
    (department) => !selectedIds.includes(department.id),
  );

  function handleRemove(id: string): void {
    const next = selectedIds.filter((selectedId) => selectedId !== id);
    if (
      next.length === 0 &&
      shouldConfirmClear &&
      !window.confirm(t("tasks.department.clearConfirm"))
    ) {
      return;
    }
    onChange(next);
  }

  function canRemove(id: string): boolean {
    return (
      !disabled &&
      (selectedIds.length === 1 ||
        selectable.some((department) => department.id === id))
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <ul
        aria-label={t("tasks.fields.department")}
        className="flex min-w-0 flex-wrap items-center gap-1.5"
      >
        {selectedIds.length === 0 ? (
          <li className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {t("tasks.department.noneChip")}
          </li>
        ) : null}
        {selectedIds.map((id) => (
          <li
            key={id}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-info-subtle px-2 py-0.5 text-xs font-medium text-info"
          >
            <span className="truncate">{nameOf(id)}</span>
            {canRemove(id) ? (
              <button
                aria-label={t("tasks.department.remove", { name: nameOf(id) })}
                className="inline-flex size-4 items-center justify-center rounded hover:bg-info/15 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                onClick={() => handleRemove(id)}
                type="button"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
        {!disabled && addable.length > 0 ? (
          <li>
            <Select
              ariaLabel={t("tasks.department.add")}
              className="min-w-0"
              onValueChange={(id) => onChange([...selectedIds, id])}
              options={addable.map((department) => ({
                label: department.name,
                value: department.id,
              }))}
              placeholder={t("tasks.department.add")}
              value=""
            />
          </li>
        ) : null}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t(
          selectedIds.length === 0
            ? "tasks.department.noneHint"
            : "tasks.department.restrictedHint",
        )}
      </p>
    </div>
  );
}
