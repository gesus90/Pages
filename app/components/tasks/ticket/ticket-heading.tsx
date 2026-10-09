import { ArrowLeft, Edit3, Link2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { EditableTicketTitle } from "@/app/components/tasks/detail/detail-header";
import { TaskTypeBadge } from "@/app/components/tasks/task-badges";
import { Button } from "@/app/components/ui/button";

import type { WorkItemDetail } from "@/definition/Task";

interface TicketHeadingProps {
  readonly ticket: WorkItemDetail;
  readonly isArchived: boolean;
  readonly canWrite: boolean;
  readonly onBack: () => void;
  readonly onEdit: () => void;
  readonly onSaveTitle: (title: string) => void;
  /** Adds a child of the level below; `null` for subtasks. */
  readonly onCreateChild: (() => void) | null;
}

/** Copies the address of the ticket and tells how it went. */
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

/**
 * Renders type, key, the editable title and the actions of a ticket: back to
 * the board, add a child, edit everything, copy the link (A8.2-E07).
 */
export function TicketHeading({
  ticket,
  isArchived,
  canWrite,
  onBack,
  onEdit,
  onSaveTitle,
  onCreateChild,
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
          <span className="rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
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
