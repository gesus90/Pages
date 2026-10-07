import { Tag } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/cn";

import type { Label } from "@/definition/Task";

interface LabelFilterProps {
  readonly labels: readonly Label[];
  readonly selectedIds: readonly string[];
  readonly onChange: (labelIds: readonly string[]) => void;
}

/** Renders the menu that picks the labels of which a ticket needs at least one. */
export function LabelFilter({
  labels,
  selectedIds,
  onChange,
}: LabelFilterProps): React.ReactElement {
  const { t } = useTranslation();

  function toggle(labelId: string, isChecked: boolean): void {
    onChange(
      isChecked
        ? [...selectedIds, labelId]
        : selectedIds.filter((selectedId) => selectedId !== labelId),
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("tasks.filter.labels")}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg bg-surface px-2.5 text-xs font-medium text-foreground shadow-xs outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary",
            selectedIds.length > 0 && "ring-1 ring-primary",
          )}
          type="button"
        >
          <Tag className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {selectedIds.length > 0
            ? t("tasks.filter.labelsSelected", { count: selectedIds.length })
            : t("tasks.filter.allLabels")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {labels.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("tasks.filter.noLabels")}
          </p>
        ) : null}
        {labels.map((label) => (
          <DropdownMenuCheckboxItem
            checked={selectedIds.includes(label.id)}
            key={label.id}
            onCheckedChange={(isChecked) => toggle(label.id, isChecked)}
            onSelect={(event) => event.preventDefault()}
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: label.color }}
              aria-hidden="true"
            />
            {label.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
