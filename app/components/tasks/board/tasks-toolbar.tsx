import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { ToolbarFilterPanel } from "@/app/components/tasks/board/toolbar-filter-panel";
import { ToolbarProjectSelect } from "@/app/components/tasks/board/toolbar-project-select";
import { ToolbarTitle } from "@/app/components/tasks/board/toolbar-title";
import { ToolbarViewOptions } from "@/app/components/tasks/board/toolbar-view-options";
import { ToolbarViewSwitch } from "@/app/components/tasks/board/toolbar-view-switch";

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
