import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from "@floating-ui/dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, SlidersHorizontal, Tag } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAssigneeOptions } from "@/app/components/tasks/assignee-options";
import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import { countActiveFilters, FILTER_ALL } from "@/app/lib/task-filters";
import {
  BOARD_FILTER_NONE,
  DEFAULT_BOARD_PREFERENCES,
} from "@/definition/BoardPreferences";

import type { BoardPreferencesState } from "@/app/components/tasks/board/use-board-preferences";
import type { ArchivedFilter } from "@/app/lib/tasks-view";
import type { Project } from "@/definition/Project";
import type { Label, Milestone, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { ComponentProps, ReactNode } from "react";

const TYPE_OPTION_VALUES = [
  "work",
  "all",
  "initiative",
  "epic",
  "task",
  "subtask",
] as const;

const PRIORITY_OPTION_VALUES = ["urgent", "high", "normal", "low"] as const;

/** Shared filter state and project options passed into the toolbar and filter panel. */
export interface ToolbarFilterSelectsProps {
  readonly board: BoardPreferencesState;
  readonly projects: readonly Project[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly archivedFilter: ArchivedFilter;
  /** Whether the archive filter is offered; only those who may archive see it. */
  readonly canFilterArchived: boolean;
  readonly onArchivedChange: (value: ArchivedFilter) => void;
}

interface ToolbarFilterPanelProps extends ToolbarFilterSelectsProps {
  readonly assignees: readonly User[];
  readonly labels: readonly Label[];
}

interface PanelPosition {
  readonly x: number;
  readonly y: number;
  readonly maxHeight: number;
}

interface ToolbarFilterToggleProps extends ComponentProps<"button"> {
  readonly activeCount: number;
}

interface ToolbarFilterFieldProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly order: string;
}

interface LabelFilterProps {
  readonly labels: readonly Label[];
  readonly selectedIds: readonly string[];
  readonly onChange: (labelIds: readonly string[]) => void;
}

interface ToolbarPeopleFiltersProps {
  readonly board: BoardPreferencesState;
  readonly assignees: readonly User[];
  readonly labels: readonly Label[];
}

function useFilterPanelPosition(
  trigger: HTMLElement | null,
  panel: HTMLElement | null,
): React.CSSProperties {
  const [position, setPosition] = useState<PanelPosition | null>(null);

  useLayoutEffect(() => {
    if (!trigger || !panel) return undefined;
    let isCurrent = true;
    let maxHeight = 0;

    async function place(): Promise<void> {
      if (!trigger || !panel) return;
      const placed = await computePosition(trigger, panel, {
        placement: "bottom-end",
        strategy: "fixed",
        middleware: [
          offset(8),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply: ({ availableHeight }) => {
              maxHeight = availableHeight;
            },
          }),
        ],
      });
      if (isCurrent) setPosition({ x: placed.x, y: placed.y, maxHeight });
    }

    const stop = autoUpdate(trigger, panel, () => void place());
    return () => {
      isCurrent = false;
      stop();
    };
  }, [trigger, panel]);

  return position
    ? {
        position: "fixed",
        left: position.x,
        top: position.y,
        maxHeight: position.maxHeight,
      }
    : { position: "fixed", left: 0, top: 0, opacity: 0, pointerEvents: "none" };
}

function ToolbarFilterToggle({
  activeCount,
  ...properties
}: ToolbarFilterToggleProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Button
      className="group gap-2 data-[state=open]:text-primary-text"
      size="sm"
      type="button"
      variant="outline"
      {...properties}
    >
      <SlidersHorizontal className="size-4" aria-hidden="true" />
      {t("tasks.filter.toggle")}
      {activeCount > 0 ? (
        <span
          aria-label={t("tasks.filter.activeCount", { count: activeCount })}
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
        >
          {activeCount}
        </span>
      ) : null}
      <ChevronDown
        className="size-4 transition-transform group-data-[state=open]:rotate-180"
        aria-hidden="true"
      />
    </Button>
  );
}

function ToolbarFilterField({
  children,
  label,
  order,
}: ToolbarFilterFieldProps): React.ReactElement {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${order}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function LabelFilter({
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
            "inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg bg-surface px-2.5 text-xs font-medium text-foreground shadow-xs outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary",
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

function ToolbarFilterSelects({
  board,
  statuses,
  milestones,
  archivedFilter,
  canFilterArchived,
  onArchivedChange,
}: ToolbarFilterSelectsProps): React.ReactElement {
  const { t } = useTranslation();
  const { preferences, update } = board;

  return (
    <>
      <ToolbarFilterField label={t("tasks.filter.type")} order="order-1">
        <Select
          className="w-full"
          ariaLabel={t("tasks.filter.type")}
          value={preferences.type}
          onValueChange={(type) => update({ type })}
          options={TYPE_OPTION_VALUES.map((value) => ({
            value,
            label: t(`tasks.filter.typeOption.${value}`),
          }))}
        />
      </ToolbarFilterField>

      <ToolbarFilterField label={t("tasks.filter.status")} order="order-2">
        <Select
          className="w-full"
          ariaLabel={t("tasks.filter.status")}
          value={preferences.status}
          onValueChange={(status) => update({ status })}
          options={[
            { value: FILTER_ALL, label: t("tasks.filter.allStatuses") },
            ...statuses.map((status) => ({
              value: status.id,
              label: status.name,
            })),
          ]}
        />
      </ToolbarFilterField>

      <ToolbarFilterField label={t("tasks.filter.priority")} order="order-3">
        <Select
          className="w-full"
          ariaLabel={t("tasks.filter.priority")}
          value={preferences.priority}
          onValueChange={(priority) => update({ priority })}
          options={[
            { value: FILTER_ALL, label: t("tasks.filter.allPriorities") },
            ...PRIORITY_OPTION_VALUES.map((value) => ({
              value,
              label: t(`tasks.priority.${value}`),
            })),
          ]}
        />
      </ToolbarFilterField>

      <ToolbarFilterField label={t("tasks.filter.milestone")} order="order-4">
        <Select
          className="w-full"
          ariaLabel={t("tasks.filter.milestone")}
          value={preferences.milestone}
          onValueChange={(milestone) => update({ milestone })}
          options={[
            { value: FILTER_ALL, label: t("tasks.filter.allMilestones") },
            ...milestones.map((milestone) => ({
              value: milestone.id,
              label: milestone.name,
            })),
          ]}
        />
      </ToolbarFilterField>

      {canFilterArchived ? (
        <ToolbarFilterField label={t("tasks.filter.archived")} order="order-7">
          <Select
            className="w-full"
            ariaLabel={t("tasks.filter.archived")}
            value={archivedFilter}
            onValueChange={onArchivedChange}
            options={[
              { value: "active", label: t("tasks.filter.active") },
              { value: "archived", label: t("tasks.filter.archivedTickets") },
              { value: "all", label: t("tasks.filter.all") },
            ]}
          />
        </ToolbarFilterField>
      ) : null}
    </>
  );
}

function ToolbarPeopleFilters({
  board,
  assignees,
  labels,
}: ToolbarPeopleFiltersProps): React.ReactElement {
  const { t } = useTranslation();
  const { departments } = useTicketAccess();
  const assigneeOptions = useAssigneeOptions(assignees);
  const { preferences, update } = board;

  return (
    <>
      <ToolbarFilterField label={t("tasks.filter.assignee")} order="order-5">
        <Select
          className="w-full"
          ariaLabel={t("tasks.filter.assignee")}
          value={preferences.assignee}
          onValueChange={(assignee) => update({ assignee })}
          options={[
            { value: FILTER_ALL, label: t("tasks.filter.allAssignees") },
            ...assigneeOptions.map((option) =>
              option.value === ""
                ? { ...option, value: BOARD_FILTER_NONE }
                : option,
            ),
          ]}
        />
      </ToolbarFilterField>

      <ToolbarFilterField label={t("tasks.filter.department")} order="order-6">
        <Select
          className="w-full"
          ariaLabel={t("tasks.filter.department")}
          value={preferences.department}
          onValueChange={(department) => update({ department })}
          options={[
            { value: FILTER_ALL, label: t("tasks.filter.allDepartments") },
            { value: BOARD_FILTER_NONE, label: t("tasks.filter.noDepartment") },
            ...departments.map((department) => ({
              value: department.id,
              label: department.name,
            })),
          ]}
        />
      </ToolbarFilterField>

      <ToolbarFilterField label={t("tasks.filter.labels")} order="order-8">
        <LabelFilter
          labels={labels}
          onChange={(labelIds) => update({ labelIds })}
          selectedIds={preferences.labelIds}
        />
      </ToolbarFilterField>
    </>
  );
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
