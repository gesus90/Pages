import { ArrowLeft, Edit3, Link2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { EditableTicketTitle } from "@/app/components/tasks/detail/detail-header";
import { TicketArchiveAction } from "@/app/components/tasks/lifecycle/ticket-archive-action";
import { TaskTypeBadge } from "@/app/components/tasks/task-badges";
import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Button } from "@/app/components/ui/button";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { WorkItemDescendants, WorkItemDetail } from "@/definition/Task";

interface TicketTopProps {
  readonly ticket: WorkItemDetail;
  readonly actions: TaskPanelActions;
  readonly canWrite: boolean;
  readonly isArchived: boolean;
  readonly isArchiving: boolean;
  /** What archiving reaches and whether the visitor may archive; `null` when unknown. */
  readonly descendants: WorkItemDescendants | null;
  readonly onBack: () => void;
  readonly onEdit: () => void;
  readonly onCreateChild: (() => void) | null;
}

interface TicketHeadingProps {
  readonly ticket: WorkItemDetail;
  readonly isArchived: boolean;
  readonly canWrite: boolean;
  readonly onBack: () => void;
  readonly onEdit: () => void;
  readonly onSaveTitle: (title: string) => void;
  readonly onCreateChild: (() => void) | null;
  readonly archiveAction?: React.ReactNode;
}

interface TicketArchivedBannerProps {
  readonly ticketId: string;
  readonly isArchiving: boolean;
}

function CopyLinkButton({
  ticketKey,
}: {
  readonly ticketKey: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<string | null>(null);

  async function handleCopy(): Promise<void> {
    const address = `${window.location.origin}/aufgaben/${ticketKey}`;

    try {
      await navigator.clipboard.writeText(address);
      setNotice(t("tasks.detail.linkCopied"));
    } catch (error: unknown) {
      // Without clipboard access the address is shown to copy by hand.
      console.warn("Pages could not copy the ticket link.", error);
      setNotice(address);
    }
  }

  return (
    <>
      <Button
        className="gap-1.5"
        type="button"
        variant="ghost"
        onClick={() => void handleCopy()}
      >
        <Link2 aria-hidden="true" className="size-4" />
        {t("tasks.detail.copyLink")}
      </Button>
      <span
        aria-live="polite"
        className="pages-selectable text-xs"
        role="status"
      >
        {notice}
      </span>
    </>
  );
}

function TicketHeading({
  ticket,
  isArchived,
  canWrite,
  onBack,
  onEdit,
  onSaveTitle,
  onCreateChild,
  archiveAction = null,
}: TicketHeadingProps): React.ReactElement {
  const { t } = useTranslation();
  const canChange = canWrite && !isArchived;

  return (
    // Title before the actions on phones; actions beside both on wider screens.
    <header className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="flex items-center gap-2">
        <TaskTypeBadge type={ticket.type} />
        <span className="text-xs font-semibold text-muted-foreground">
          {ticket.key}
        </span>
        {isArchived ? (
          <span className="rounded-md bg-notice-chip px-2 py-0.5 text-xs font-semibold text-notice">
            {t("tasks.archived.badge")}
          </span>
        ) : null}
      </div>
      <div
        aria-label={t("tasks.detail.actions")}
        className="order-last flex flex-wrap items-center gap-2 md:order-none md:row-span-2 md:justify-end"
        role="group"
      >
        <Button
          className="gap-1.5"
          type="button"
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("tasks.detail.backToBoard")}
        </Button>
        {canChange && onCreateChild ? (
          <Button
            className="gap-1.5"
            type="button"
            variant="outline"
            onClick={onCreateChild}
          >
            <Plus aria-hidden="true" className="size-4" />
            {t(`tasks.children.add.${ticket.type}`)}
          </Button>
        ) : null}
        <CopyLinkButton ticketKey={ticket.key} />
        {archiveAction}
        <Button
          className="gap-1.5"
          disabled={!canChange}
          type="button"
          onClick={onEdit}
        >
          <Edit3 aria-hidden="true" className="size-4" />
          {t("tasks.actions.edit")}
        </Button>
      </div>
      <div className="min-w-0">
        <EditableTicketTitle
          level="h1"
          isArchived={!canChange}
          onSave={onSaveTitle}
          title={ticket.title}
        />
      </div>
    </header>
  );
}

function TicketArchivedBanner({
  ticketId,
  isArchiving,
}: TicketArchivedBannerProps): React.ReactElement {
  const { t } = useTranslation();
  const { canWrite } = useTicketAccess();

  return (
    <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-notice-subtle p-3 text-xs">
      <span className="font-semibold text-foreground">
        {t("tasks.archived.banner")}
      </span>
      {canWrite ? (
        <Form method="post">
          <input name="intent" type="hidden" value="restore-task" />
          <input name="boardLocal" type="hidden" value="true" />
          <input name="id" type="hidden" value={ticketId} />
          <Button
            className="h-8 px-3 text-xs"
            disabled={isArchiving}
            type="submit"
            variant="ghost"
          >
            {t("tasks.archived.restore")}
          </Button>
        </Form>
      ) : null}
    </div>
  );
}

/** Renders the heading with its actions and the archive notice of a ticket. */
export function TicketTop({
  ticket,
  actions,
  canWrite,
  isArchived,
  isArchiving,
  descendants,
  onBack,
  onEdit,
  onCreateChild,
}: TicketTopProps): React.ReactElement {
  return (
    <>
      <TicketHeading
        archiveAction={
          <TicketArchiveAction
            descendants={descendants}
            isArchiving={isArchiving}
            ticket={ticket}
          />
        }
        canWrite={canWrite}
        isArchived={isArchived}
        onBack={onBack}
        onCreateChild={onCreateChild}
        onEdit={onEdit}
        onSaveTitle={(title) => actions.update({ title })}
        ticket={ticket}
      />
      {isArchived ? (
        <TicketArchivedBanner isArchiving={isArchiving} ticketId={ticket.id} />
      ) : null}
    </>
  );
}
