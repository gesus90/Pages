import { useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { ToolbarFilterSelects } from "@/app/components/tasks/board/toolbar-filter-selects";
import { ToolbarFilterToggle } from "@/app/components/tasks/board/toolbar-filter-toggle";
import { ToolbarPeopleFilters } from "@/app/components/tasks/board/toolbar-people-filters";
import { ToolbarTitle } from "@/app/components/tasks/board/toolbar-title";
import { ToolbarViewOptions } from "@/app/components/tasks/board/toolbar-view-options";
import { ToolbarViewSwitch } from "@/app/components/tasks/board/toolbar-view-switch";
import { cn } from "@/app/lib/cn";
import { countActiveFilters } from "@/app/lib/task-filters";

import type { ToolbarFilterSelectsProps } from "@/app/components/tasks/board/toolbar-filter-selects";
import type { Label } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

interface TasksToolbarProps extends ToolbarFilterSelectsProps {
  readonly assignees: readonly User[];
  readonly labels: readonly Label[];
  readonly onCreate: () => void;
  readonly templates: readonly WorkItemTemplateView[];
}

/**
 * Lays the content of a toolbar row out like the row itself on wide screens
 * and as its own wrapped row on phones, where it can be folded away.
 *
 * @param isOpen - Whether the phone-sized toolbar shows its filters.
 */
function foldableRow(isOpen: boolean): string {
  return cn(
    "max-md:order-3 max-md:w-full max-md:flex-wrap max-md:gap-2.5 md:contents",
    isOpen ? "max-md:flex" : "max-md:hidden",
  );
}

/** Renders the page title, the filters and the switch between task views. */
export function TasksToolbar(props: TasksToolbarProps): React.ReactElement {
  const { t } = useTranslation();
  const { archivedFilter, board, onCreate, templates } = props;
  const { preferences, update } = board;
  // Below the medium breakpoint the filters fold away to leave the board room.
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  return (
    <>
      <ToolbarTitle onCreate={onCreate} templates={templates} />

      <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2.5 md:mt-7">
        <SegmentedControl
          ariaLabel={t("tasks.filter.scope")}
          className={cn("max-md:order-2", !isFilterOpen && "max-md:hidden")}
          onValueChange={(scope) => update({ scope })}
          options={[
            { label: t("tasks.filter.allTasks"), value: "all" },
            { label: t("tasks.filter.myTasks"), value: "mine" },
          ]}
          value={preferences.scope}
        />

        <div className="relative h-9 min-w-52 flex-1 sm:max-w-80">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="h-9 rounded-lg bg-card pl-10 text-xs xl:h-9 xl:pl-10 xl:text-xs"
            placeholder={t("tasks.search")}
            value={board.searchText}
            onChange={(event) => update({ search: event.target.value })}
          />
        </div>

        <ToolbarFilterToggle
          activeCount={countActiveFilters(preferences, archivedFilter)}
          isOpen={isFilterOpen}
          onToggle={() => setIsFilterOpen((isOpen) => !isOpen)}
        />

        <div className={foldableRow(isFilterOpen)}>
          <ToolbarFilterSelects {...props} />
          <ToolbarPeopleFilters
            assignees={props.assignees}
            board={board}
            labels={props.labels}
          />
        </div>
      </div>

      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2.5">
        <ToolbarViewSwitch
          onViewChange={(view) => update({ view })}
          view={preferences.view}
        />
        <div className={foldableRow(isFilterOpen)}>
          <ToolbarViewOptions board={board} />
        </div>
      </div>
    </>
  );
}
