import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MarkdownText } from "@/app/components/markdown/markdown-text";
import {
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { TaskActivityList } from "@/app/components/tasks/task-activity-list";
import { Button } from "@/app/components/ui/button";
import { Tabs } from "@/app/components/ui/tabs";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { WorkItemDetail, WorkItemHistory } from "@/definition/Task";

const CHILDREN_TAB_KEYS: Readonly<Record<WorkItemDetail["type"], string>> = {
  [WORK_ITEM_TYPE.INITIATIVE]: "tasks.detail.containedEpics",
  [WORK_ITEM_TYPE.EPIC]: "tasks.detail.containedTasks",
  [WORK_ITEM_TYPE.TASK]: "tasks.tabs.subtasks",
  [WORK_ITEM_TYPE.SUBTASK]: "tasks.tabs.subtasks",
};

const CREATE_CHILD_KEYS: Readonly<Record<WorkItemDetail["type"], string>> = {
  [WORK_ITEM_TYPE.INITIATIVE]: "tasks.detail.createEpic",
  [WORK_ITEM_TYPE.EPIC]: "tasks.create.trigger",
  [WORK_ITEM_TYPE.TASK]: "tasks.actions.createSubtask",
  [WORK_ITEM_TYPE.SUBTASK]: "tasks.actions.createSubtask",
};

interface ChildrenListProps {
  readonly ticket: WorkItemDetail;
  readonly items: readonly WorkItemDetail[];
  readonly isArchived: boolean;
  readonly onCreateChild: () => void;
  readonly onOpenChild: (key: string) => void;
}

/** Renders the child tickets with a button to add one. */
function ChildrenList({
  ticket,
  items,
  isArchived,
  onCreateChild,
  onOpenChild,
}: ChildrenListProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between pb-1">
        <span className="text-xs font-semibold text-muted-foreground">
          {ticket.subtaskCompleted} / {ticket.subtaskTotal}{" "}
          {t("tasks.detail.doneSuffix")}
        </span>
        {!isArchived ? (
          <Button
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={onCreateChild}
            type="button"
            variant="outline"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t(CREATE_CHILD_KEYS[ticket.type])}
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl bg-muted/40 p-8 text-center text-xs text-muted-foreground">
          {t("tasks.none")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((child) => (
            <li key={child.id}>
              <button
                className="flex w-full items-center gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-left text-sm hover:bg-muted"
                onClick={() => onOpenChild(child.key)}
                type="button"
              >
                <TaskTypeBadge type={child.type} />
                <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                  {child.key}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {child.title}
                </span>
                <TaskStatusBadge
                  statusKey={child.statusKey}
                  statusName={child.statusName}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TicketTabsProps {
  readonly ticket: WorkItemDetail;
  readonly items: readonly WorkItemDetail[];
  readonly history: readonly WorkItemHistory[];
  readonly isArchived: boolean;
  readonly onCreateChild: () => void;
  readonly onOpenChild: (key: string) => void;
}

/** Renders the description, child ticket and activity tabs of a ticket. */
export function TicketTabs({
  ticket,
  items,
  history,
  isArchived,
  onCreateChild,
  onOpenChild,
}: TicketTabsProps): React.ReactElement {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("description");
  const showChildren = ticket.type !== WORK_ITEM_TYPE.SUBTASK;

  return (
    <div className="min-w-0">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        ariaLabel={ticket.key}
        tabs={[
          { value: "description", label: t("tasks.tabs.description") },
          ...(showChildren
            ? [
                {
                  value: "children",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {t(CHILDREN_TAB_KEYS[ticket.type])}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-foreground">
                        {items.length}
                      </span>
                    </span>
                  ),
                },
              ]
            : []),
          { value: "activity", label: t("tasks.tabs.activity") },
        ]}
      />

      <div className="mt-4">
        {activeTab === "description" ? (
          <div className="rounded-xl bg-muted/40 p-5 text-sm leading-relaxed text-muted-foreground">
            {ticket.description ? (
              <MarkdownText source={ticket.description} />
            ) : (
              <p className="italic text-muted-foreground/70">
                {t("tasks.none")}
              </p>
            )}
          </div>
        ) : null}

        {activeTab === "children" && showChildren ? (
          <ChildrenList
            items={items}
            isArchived={isArchived}
            onCreateChild={onCreateChild}
            onOpenChild={onOpenChild}
            ticket={ticket}
          />
        ) : null}

        {activeTab === "activity" ? (
          <TaskActivityList history={history} />
        ) : null}
      </div>
    </div>
  );
}
