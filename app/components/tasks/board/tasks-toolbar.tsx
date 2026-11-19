import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Flag,
  Kanban,
  List,
  Plus,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ToolbarFilterPanel } from "@/app/components/tasks/board/toolbar-filter-panel";
import { TemplateManagerDialog } from "@/app/components/tasks/templates/template-manager-dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { Select } from "@/app/components/ui/select";
import { FILTER_ALL } from "@/app/lib/task-filters";
import { BOARD_GROUPS, BOARD_SORT_FIELDS } from "@/definition/BoardPreferences";

import type { ToolbarFilterSelectsProps } from "@/app/components/tasks/board/toolbar-filter-panel";
import type { BoardPreferencesState } from "@/app/components/tasks/board/use-board-preferences";
import type { SegmentedControlOption } from "@/app/components/ui/segmented-control";
import type { BoardView } from "@/definition/BoardPreferences";
import type { Project } from "@/definition/Project";
import type { Label } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

interface TasksToolbarProps extends ToolbarFilterSelectsProps {
  readonly assignees: readonly User[];
  readonly labels: readonly Label[];
  readonly onCreate: () => void;
  readonly templates: readonly WorkItemTemplateView[];
}

interface ToolbarTitleProps {
  readonly onCreate: () => void;
  readonly templates: readonly WorkItemTemplateView[];
}

interface ToolbarProjectSelectProps {
  readonly board: BoardPreferencesState;
  readonly projects: readonly Project[];
}

interface ToolbarViewSwitchProps {
  readonly view: BoardView;
  readonly onViewChange: (view: BoardView) => void;
}

interface ToolbarViewOptionsProps {
  readonly board: BoardPreferencesState;
}

function ToolbarTitle({
  onCreate,
  templates,
}: ToolbarTitleProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="select-none text-3xl font-semibold tracking-tight text-foreground xl:text-2xl">
          {t("tasks.title")}
        </h1>
        <p className="mt-1.5 select-none text-sm text-muted-foreground max-md:hidden">
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
  );
}

function ToolbarProjectSelect({
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

function ToolbarViewSwitch({
  view,
  onViewChange,
}: ToolbarViewSwitchProps): React.ReactElement {
  const { t } = useTranslation();
  const options: SegmentedControlOption<BoardView>[] = [
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
      icon: <Flag className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.milestones"),
      value: "milestones",
    },
  ];

  return (
    <ScrollViewport axis="horizontal" containerClassName="max-w-full">
      <SegmentedControl
        ariaLabel={t("tasks.view.label")}
        className="w-max min-w-full"
        onValueChange={onViewChange}
        options={options}
        value={view}
      />
    </ScrollViewport>
  );
}

function ToolbarViewOptions({
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

      {preferences.view === "kanban" ? (
        <Select
          ariaLabel={t("tasks.group.title")}
          value={preferences.group}
          onValueChange={(group) => update({ group })}
          options={BOARD_GROUPS.map((value) => ({
            value,
            label: t(`tasks.group.${value}`),
          }))}
        />
      ) : null}
    </>
  );
}

/** Renders the page title, the filters and the switch between task views. */
export function TasksToolbar(props: TasksToolbarProps): React.ReactElement {
  const { t } = useTranslation();
  const { board, onCreate, templates } = props;
  const { preferences, update } = board;

  return (
    <>
      <ToolbarTitle onCreate={onCreate} templates={templates} />

      <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2.5 md:mt-7">
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
            aria-label={t("tasks.search")}
            className="h-9 rounded-lg bg-card pl-10 text-xs xl:h-9 xl:pl-10 xl:text-xs"
            placeholder={t("tasks.search")}
            value={board.searchText}
            onChange={(event) => update({ search: event.target.value })}
          />
        </div>

        <ToolbarProjectSelect board={board} projects={props.projects} />
        <ToolbarFilterPanel {...props} />
      </div>

      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2.5">
        <ToolbarViewSwitch
          onViewChange={(view) => update({ view })}
          view={preferences.view}
        />
        <ToolbarViewOptions board={board} />
      </div>
    </>
  );
}
