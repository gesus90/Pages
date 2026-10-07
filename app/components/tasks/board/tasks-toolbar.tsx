import { Flag, Kanban, List, Network, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TemplateManagerDialog } from "@/app/components/tasks/templates/template-manager-dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { ToolbarFilterSelects } from "@/app/components/tasks/board/toolbar-filter-selects";
import { ToolbarPeopleFilters } from "@/app/components/tasks/board/toolbar-people-filters";
import { ToolbarViewOptions } from "@/app/components/tasks/board/toolbar-view-options";

import type { ToolbarFilterSelectsProps } from "@/app/components/tasks/board/toolbar-filter-selects";
import type { SegmentedControlOption } from "@/app/components/ui/segmented-control";
import type { BoardView } from "@/definition/BoardPreferences";
import type { Label } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

interface TasksToolbarProps extends ToolbarFilterSelectsProps {
  readonly assignees: readonly User[];
  readonly labels: readonly Label[];
  readonly onCreate: () => void;
  readonly templates: readonly WorkItemTemplateView[];
}

/** Renders the page title, the filters and the switch between task views. */
export function TasksToolbar(props: TasksToolbarProps): React.ReactElement {
  const { t } = useTranslation();
  const { board, onCreate, templates } = props;
  const { preferences, update } = board;
  const viewOptions: SegmentedControlOption<BoardView>[] = [
    {
      icon: <Kanban className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.kanban"),
      value: "kanban",
    },
    {
      icon: <List className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.list"),
      value: "list",
    },
    {
      icon: <Network className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.hierarchy"),
      value: "hierarchy",
    },
    {
      icon: <Flag className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.milestones"),
      value: "milestones",
    },
    { label: t("tasks.view.github"), value: "github" },
  ];

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="select-none text-3xl font-semibold tracking-tight text-foreground xl:text-2xl">
            {t("tasks.title")}
          </h1>
          <p className="mt-1.5 select-none text-sm text-muted-foreground">
            {t("tasks.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TemplateManagerDialog templates={templates} />
          <Button className="gap-2" onClick={onCreate} type="button">
            <Plus className="size-4" aria-hidden="true" />
            {t("tasks.create.trigger")}
          </Button>
        </div>
      </div>

      <div className="mt-7 flex shrink-0 flex-wrap items-center gap-2.5">
        <SegmentedControl
          ariaLabel={t("tasks.filter.scope")}
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

        <ToolbarFilterSelects {...props} />
        <ToolbarPeopleFilters
          assignees={props.assignees}
          board={board}
          labels={props.labels}
        />
      </div>

      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2.5">
        <SegmentedControl
          ariaLabel={t("tasks.view.label")}
          onValueChange={(view) => update({ view })}
          options={viewOptions}
          value={preferences.view}
        />
        <ToolbarViewOptions board={board} />
      </div>
    </>
  );
}
