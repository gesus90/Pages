import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ToolbarFilterSelects } from "./toolbar-filter-selects";
import { ToolbarFilterToggle } from "./toolbar-filter-toggle";
import { ToolbarPeopleFilters } from "./toolbar-people-filters";
import { useFilterPanelPosition } from "./use-filter-panel-position";
import { Button } from "@/app/components/ui/button";
import { countActiveFilters } from "@/app/lib/task-filters";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";

import type { ToolbarFilterSelectsProps } from "./toolbar-filter-selects";
import type { Label } from "@/definition/Task";
import type { User } from "@/definition/User";

interface ToolbarFilterPanelProps extends ToolbarFilterSelectsProps {
  readonly assignees: readonly User[];
  readonly labels: readonly Label[];
}

/** Groups the less frequent filters in an anchored, non-modal dialog. */
export function ToolbarFilterPanel(
  props: ToolbarFilterPanelProps,
): React.ReactElement {
  const { t } = useTranslation();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const style = useFilterPanelPosition(trigger, panel);
  const { board, archivedFilter } = props;
  const defaults = DEFAULT_BOARD_PREFERENCES;
  const activeCount = countActiveFilters(
    { ...board.preferences, scope: defaults.scope, project: defaults.project },
    archivedFilter,
  );

  function reset(): void {
    board.update(
      {
        assignee: defaults.assignee,
        department: defaults.department,
        labelIds: defaults.labelIds,
        milestone: defaults.milestone,
        priority: defaults.priority,
        status: defaults.status,
        type: defaults.type,
      },
      archivedFilter === "active" ? undefined : { archivedFilter: "active" },
    );
  }

  return (
    <DialogPrimitive.Root modal={false}>
      <DialogPrimitive.Trigger asChild>
        <ToolbarFilterToggle activeCount={activeCount} ref={setTrigger} />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="z-50 w-[min(38rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl bg-surface p-4 shadow-panel outline-none sm:p-5"
          ref={setPanel}
          style={style}
        >
          <div className="flex items-center justify-between gap-4">
            <DialogPrimitive.Title className="text-sm font-semibold text-foreground">
              {t("tasks.filter.toggle")}
            </DialogPrimitive.Title>
            <Button onClick={reset} size="xs" type="button" variant="ghost">
              {t("tasks.filter.reset")}
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <ToolbarFilterSelects {...props} />
            <ToolbarPeopleFilters
              assignees={props.assignees}
              board={board}
              labels={props.labels}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
