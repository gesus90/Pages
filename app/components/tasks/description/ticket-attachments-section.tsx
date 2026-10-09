import { Download, Paperclip, Trash2 } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { formatBytes } from "@/app/lib/format-bytes";
import { ticketAttachmentPath } from "@/app/lib/ticket-upload";

import type { WorkItemAttachment } from "@/definition/Task";
import type { TicketUploadsState } from "./use-ticket-uploads";

interface TicketAttachmentsSectionProps {
  readonly attachments: readonly WorkItemAttachment[];
  readonly canEdit: boolean;
  readonly uploads: TicketUploadsState;
}

/** Shows the running upload or why the last one failed. */
function UploadState({
  uploads,
}: {
  readonly uploads: TicketUploadsState;
}): React.ReactElement | null {
  const { t } = useTranslation();

  if (uploads.progress !== null && uploads.fileName !== null) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        {t("tasks.attachments.uploading", {
          name: uploads.fileName,
          percent: Math.round(uploads.progress * 100),
        })}
      </p>
    );
  }

  return uploads.errorCode ? (
    <p className="text-xs text-destructive" role="alert">
      {t("tasks.attachments.failed", {
        reason: t(`tasks.error.${uploads.errorCode}`, {
          defaultValue: uploads.errorCode,
        }),
      })}
    </p>
  ) : null;
}

/** One attached file with download and, for writers, removal. */
function AttachmentRow({
  attachment,
  canEdit,
}: {
  readonly attachment: WorkItemAttachment;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const address = ticketAttachmentPath(attachment.id);

  return (
    <li className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
      <Paperclip
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <a
        className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline"
        href={address}
        rel="noreferrer"
        target="_blank"
      >
        {attachment.fileName}
      </a>
      <span className="shrink-0 text-xs text-muted-foreground">
        {t("tasks.attachments.meta", {
          size: formatBytes(attachment.size),
          user: attachment.uploadedByName ?? "—",
        })}
      </span>
      <a
        aria-label={t("tasks.attachments.download", {
          name: attachment.fileName,
        })}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        href={`${address}?download=1`}
      >
        <Download aria-hidden="true" className="size-4" />
      </a>
      {canEdit ? (
        <button
          aria-label={t("tasks.attachments.remove", {
            name: attachment.fileName,
          })}
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
          disabled={fetcher.state !== "idle"}
          type="button"
          onClick={() =>
            void fetcher.submit(
              { attachmentId: attachment.id, intent: "remove-attachment" },
              { action: "/aufgaben", method: "post" },
            )
          }
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </li>
  );
}

/** The files attached to a ticket, with upload for writers (A8.2-E06). */
export function TicketAttachmentsSection({
  attachments,
  canEdit,
  uploads,
}: TicketAttachmentsSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);

  async function handleFiles(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const files = [...(event.target.files ?? [])];

    event.target.value = "";
    await uploads.upload(files);
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("tasks.attachments.title")}
          <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs text-foreground">
            {attachments.length}
          </span>
        </h2>
        {canEdit ? (
          <Button
            className="h-8 gap-1.5 px-3 text-xs"
            type="button"
            variant="outline"
            onClick={() => input.current?.click()}
          >
            <Paperclip aria-hidden="true" className="size-3.5" />
            {t("tasks.attachments.add")}
          </Button>
        ) : null}
      </div>
      <UploadState uploads={uploads} />
      {attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("tasks.attachments.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
      <input
        ref={input}
        hidden
        multiple
        type="file"
        onChange={(event) => void handleFiles(event)}
      />
    </section>
  );
}
