import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { BOARD_GROUPS, BOARD_SORT_FIELDS } from "@/definition/BoardPreferences";

import type { BoardPreferencesState } from "@/app/components/tasks/board/use-board-preferences";

interface ToolbarViewOptionsProps {
  readonly board: BoardPreferencesState;
}

/** Renders the sort order, its direction and the grouping of the board. */
export function ToolbarViewOptions({
  board,
}: ToolbarViewOptionsProps): React.ReactElement {
  const { t } = useTranslation();
  const { preferences, update } = board;
  const isAscending = preferences.direction === "asc";
  const DirectionIcon = isAscending ? ArrowUpNarrowWide : ArrowDownWideNarrow;

  return (
    <>
      <Select
        ariaLabel={t("tasks.sort.label")}
        value={preferences.sort}
        onValueChange={(sort) => update({ sort })}
        options={BOARD_SORT_FIELDS.map((value) => ({
          value,
          label: t(`tasks.sort.${value}`),
        }))}
      />

      <button
        aria-label={t(
          isAscending ? "tasks.sort.ascending" : "tasks.sort.descending",
        )}
        className="inline-flex size-9 items-center justify-center rounded-lg bg-surface text-muted-foreground shadow-xs outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => update({ direction: isAscending ? "desc" : "asc" })}
        type="button"
      >
        <DirectionIcon className="size-4" aria-hidden="true" />
      </button>

      <Select
        ariaLabel={t("tasks.group.title")}
        value={preferences.group}
        onValueChange={(group) => update({ group })}
        options={BOARD_GROUPS.map((value) => ({
          value,
          label: t(`tasks.group.${value}`),
        }))}
      />
    </>
  );
}
