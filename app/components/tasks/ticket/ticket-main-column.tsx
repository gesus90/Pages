import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useRevalidator } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { TicketAttachmentsSection } from "@/app/components/tasks/description/ticket-attachments-section";
import { TicketDescription } from "@/app/components/tasks/description/ticket-description";
import { useTicketUploads } from "@/app/components/tasks/description/use-ticket-uploads";
import { DetailChecklistSection } from "@/app/components/tasks/detail/detail-checklist-section";
import { DetailLinksSection } from "@/app/components/tasks/detail/detail-links-section";
import {
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { Button } from "@/app/components/ui/button";
import { WORK_ITEM_CHILD_TYPE } from "@/definition/Task";

import type {
  WorkItemAttachment,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkItemType,
} from "@/definition/Task";

const CHILD_SECTION_TITLE_KEYS: Readonly<Record<WorkItemType, string>> = {
  epic: "tasks.detail.containedTasks",
  initiative: "tasks.detail.containedEpics",
  subtask: "tasks.tabs.subtasks",
  task: "tasks.tabs.subtasks",
};

interface TicketMainColumnProps {
  readonly ticket: WorkItemDetail;
  readonly canWrite: boolean;
  readonly children: readonly WorkItemDetail[];
  readonly attachments: readonly WorkItemAttachment[];
  readonly checklist: readonly WorkItemChecklistItem[];
  readonly links: readonly WorkItemLink[];
  readonly history: readonly WorkItemHistory[];
  readonly projectWorkItems: readonly WorkItemDetail[];
  readonly isSubmitting: boolean;
  readonly onCreateChild: () => void;
  readonly onOpenTicket: (key: string) => void;
  readonly hrefOf: (key: string) => string;
}

interface TicketChildrenSectionProps {
  readonly ticket: WorkItemDetail;
  readonly items: readonly WorkItemDetail[];
  readonly canAdd: boolean;
  readonly onCreateChild: () => void;
  readonly hrefOf: (key: string) => string;
}

interface TaskActivityListProps {
  readonly history: readonly WorkItemHistory[];
}

function TicketChildrenSection({
  ticket,
  items,
  canAdd,
  onCreateChild,
  hrefOf,
}: TicketChildrenSectionProps): React.ReactElement | null {
  const { t } = useTranslation();

  if (WORK_ITEM_CHILD_TYPE[ticket.type] === null) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t(CHILD_SECTION_TITLE_KEYS[ticket.type])}
          <span className="ml-2 text-xs font-medium text-muted-foreground">
            {ticket.subtaskCompleted} / {ticket.subtaskTotal}{" "}
            {t("tasks.detail.doneSuffix")}
          </span>
        </h2>
        {canAdd ? (
          <Button
            className="h-8 gap-1.5 px-3 text-xs"
            type="button"
            variant="outline"
            onClick={onCreateChild}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {t(`tasks.children.add.${ticket.type}`)}
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("tasks.children.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((child) => (
            <li key={child.id}>
              <Link
                className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-left text-sm hover:bg-muted"
                prefetch="intent"
                to={hrefOf(child.key)}
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskActivityList({
  history,
}: TaskActivityListProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();

  if (history.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {t("tasks.none")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {history.map((record) => (
        <li key={record.id} className="rounded-xl bg-muted/40 p-3 text-xs">
          <p className="font-medium text-foreground">
            {t(`tasks.history.${record.action}`, {
              field: record.field ?? "",
              newValue: record.newValue ?? "",
              oldValue: record.oldValue ?? "",
              user: record.userDisplayName ?? "Benutzer",
            })}
          </p>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            {formatDateTime(record.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The left column of a ticket, which takes most of the space: the
 * large description, attachments, children, checklist, links and activity.
 */
export function TicketMainColumn({
  ticket,
  canWrite,
  children,
  attachments,
  checklist,
  links,
  history,
  projectWorkItems,
  isSubmitting,
  onCreateChild,
  onOpenTicket,
  hrefOf,
}: TicketMainColumnProps): React.ReactElement {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const isArchived = ticket.archivedAt !== null;
  const canEdit = canWrite && !isArchived;
  const uploads = useTicketUploads(
    ticket.id,
    () => void revalidator.revalidate(),
  );

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <TicketDescription canEdit={canEdit} ticket={ticket} uploads={uploads} />
      <TicketAttachmentsSection
        attachments={attachments}
        canEdit={canEdit}
        uploads={uploads}
      />
      <TicketChildrenSection
        canAdd={canEdit}
        hrefOf={hrefOf}
        items={children}
        onCreateChild={onCreateChild}
        ticket={ticket}
      />
      <DetailChecklistSection
        isArchived={isArchived}
        isSubmitting={isSubmitting}
        items={checklist}
        workItemId={ticket.id}
      />
      <DetailLinksSection
        isArchived={isArchived}
        isSyncing={isSubmitting}
        links={links}
        onSelectTask={onOpenTicket}
        task={ticket}
        workItems={projectWorkItems}
      />
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("tasks.tabs.activity")}
        </h2>
        <TaskActivityList history={history} />
      </section>
    </div>
  );
}
