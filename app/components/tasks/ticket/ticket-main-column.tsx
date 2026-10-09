import { useTranslation } from "react-i18next";
import { useRevalidator } from "react-router";

import { TicketAttachmentsSection } from "@/app/components/tasks/description/ticket-attachments-section";
import { TicketDescription } from "@/app/components/tasks/description/ticket-description";
import { useTicketUploads } from "@/app/components/tasks/description/use-ticket-uploads";
import { DetailChecklistSection } from "@/app/components/tasks/detail/detail-checklist-section";
import { DetailLinksSection } from "@/app/components/tasks/detail/detail-links-section";
import { TaskActivityList } from "@/app/components/tasks/task-activity-list";
import { TicketChildrenSection } from "@/app/components/tasks/ticket/ticket-children-section";

import type {
  WorkItemAttachment,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
} from "@/definition/Task";

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

/**
 * The left column of a ticket, which takes most of the space (A8.2-E07): the
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
