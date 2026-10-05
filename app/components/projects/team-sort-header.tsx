import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import type { SortDirection, TeamSortField } from "@/app/lib/team-members";

const DIRECTION_ICONS = { asc: ArrowUp, desc: ArrowDown } as const;

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

interface TeamSortHeaderProps {
  readonly field: TeamSortField;
  readonly label: string;
  readonly sortField: TeamSortField;
  readonly sortDirection: SortDirection;
  readonly onSort: (field: TeamSortField) => void;
  readonly className?: string;
}

/** Renders a sortable table header with a subtle direction indicator. */
export function TeamSortHeader({
  field,
  label,
  sortField,
  sortDirection,
  onSort,
  className = "px-3 py-3",
}: TeamSortHeaderProps): React.ReactElement {
  const isActive = sortField === field;
  const SortIcon = isActive ? DIRECTION_ICONS[sortDirection] : ArrowUpDown;

  function handleClick(): void {
    onSort(field);
  }

  return (
    <th
      className={className}
      aria-sort={isActive ? ARIA_SORT[sortDirection] : "none"}
    >
      <button
        className="inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
        type="button"
        onClick={handleClick}
      >
        {label}
        <SortIcon
          className={
            isActive
              ? "size-3 shrink-0 text-foreground"
              : "size-3 shrink-0 opacity-60"
          }
          aria-hidden="true"
        />
      </button>
    </th>
  );
}
