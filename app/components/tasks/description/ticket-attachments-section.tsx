import { Download, FileSearch, Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { ImageViewer } from "@/app/components/ui/image-viewer";
import { cn } from "@/app/lib/cn";
import { formatBytes } from "@/app/lib/format-bytes";
import { ticketAttachmentPath } from "@/app/lib/ticket-upload";

import type { ViewerImage } from "@/app/lib/viewer-images";
import type { WorkItemAttachment } from "@/definition/Task";
import type { TicketUploadsState } from "./use-ticket-uploads";

/** Row layouts by whether the row shows a preview, a search release and removal. */
const ROW_COLUMNS = {
  file: "grid-cols-[1rem_minmax(0,1fr)_2rem]",
  fileWithRemove: "grid-cols-[1rem_minmax(0,1fr)_2rem_2rem]",
  fileWithReleaseAndRemove: "grid-cols-[1rem_minmax(0,1fr)_2rem_2rem_2rem]",
  image: "grid-cols-[2rem_minmax(0,1fr)_2rem]",
  imageWithRemove: "grid-cols-[2rem_minmax(0,1fr)_2rem_2rem]",
} as const;

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

/** How the image viewer shows an image attachment. */
function toViewerImage(attachment: WorkItemAttachment): ViewerImage {
  const address = ticketAttachmentPath(attachment.id);

  return { alt: attachment.fileName, linkHref: address, src: address };
}

/** A small picture of an image attachment that opens the viewer. */
function AttachmentPreview({
  attachment,
  onView,
}: {
  readonly attachment: WorkItemAttachment;
  readonly onView: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <button
      aria-label={t("tasks.attachments.view", { name: attachment.fileName })}
      className="row-span-2 inline-flex size-8 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border hover:ring-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      title={t("tasks.attachments.view", { name: attachment.fileName })}
      type="button"
      onClick={onView}
    >
      <img
        alt=""
        className="size-full object-cover"
        decoding="async"
        loading="lazy"
        src={ticketAttachmentPath(attachment.id)}
      />
    </button>
  );
}

/** Releases the text of a file for the local search index or withdraws the release. */
function SearchReleaseButton({
  attachment,
}: {
  readonly attachment: WorkItemAttachment;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const isReleased = attachment.isSearchReleased;
  const label = t(
    isReleased
      ? "tasks.attachments.searchWithdraw"
      : "tasks.attachments.searchRelease",
    { name: attachment.fileName },
  );

  function handleToggle(): void {
    void fetcher.submit(
      {
        attachmentId: attachment.id,
        intent: "set-attachment-search-release",
        released: isReleased ? "0" : "1",
      },
      { action: "/aufgaben", method: "post" },
    );
  }

  return (
    <button
      aria-label={label}
      aria-pressed={isReleased}
      className={cn(
        "col-start-4 row-span-2 row-start-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted hover:text-foreground disabled:opacity-50",
        isReleased ? "text-primary" : "text-muted-foreground",
      )}
      disabled={fetcher.state !== "idle"}
      title={label}
      type="button"
      onClick={handleToggle}
    >
      <FileSearch aria-hidden="true" className="size-4" />
    </button>
  );
}

/** Which grid a row uses; only writers see release and removal. */
function rowLayout(
  hasPreview: boolean,
  canEdit: boolean,
  canRelease: boolean,
): keyof typeof ROW_COLUMNS {
  if (canRelease) return "fileWithReleaseAndRemove";

  if (hasPreview) return canEdit ? "imageWithRemove" : "image";

  return canEdit ? "fileWithRemove" : "file";
}

/** One attached file with preview of images, download and, for writers, release and removal. */
function AttachmentRow({
  attachment,
  canEdit,
  onView,
}: {
  readonly attachment: WorkItemAttachment;
  readonly canEdit: boolean;
  /** Opens the image viewer; only image attachments have it. */
  readonly onView: (() => void) | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const address = ticketAttachmentPath(attachment.id);
  // Only plain files can hold text; images, audio and video are never indexed.
  const canRelease = canEdit && attachment.kind === "file";
  const layout = rowLayout(onView !== null, canEdit, canRelease);
  const meta = t("tasks.attachments.meta", {
    size: formatBytes(attachment.size),
    user: attachment.uploadedByName ?? "—",
  });

  return (
    <li
      className={cn(
        "grid items-center gap-x-2 gap-y-0.5 rounded-lg bg-muted/40 px-3 py-2 text-sm sm:flex sm:gap-2",
        ROW_COLUMNS[layout],
      )}
    >
      {onView ? (
        <AttachmentPreview attachment={attachment} onView={onView} />
      ) : (
        <Paperclip
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
      <a
        className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline"
        href={address}
        rel="noreferrer"
        target="_blank"
        title={attachment.fileName}
      >
        {attachment.fileName}
      </a>
      <span className="col-start-2 row-start-2 min-w-0 truncate text-xs text-muted-foreground sm:shrink-0">
        {attachment.isSearchReleased
          ? `${meta} · ${t("tasks.attachments.searchReleased")}`
          : meta}
      </span>
      <a
        aria-label={t("tasks.attachments.download", {
          name: attachment.fileName,
        })}
        className="col-start-3 row-span-2 row-start-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        href={`${address}?download=1`}
      >
        <Download aria-hidden="true" className="size-4" />
      </a>
      {canRelease ? <SearchReleaseButton attachment={attachment} /> : null}
      {canEdit ? (
        <button
          aria-label={t("tasks.attachments.remove", {
            name: attachment.fileName,
          })}
          className={cn(
            "row-span-2 row-start-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50",
            canRelease ? "col-start-5" : "col-start-4",
          )}
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

/** The files attached to a ticket, with upload for writers. */
export function TicketAttachmentsSection({
  attachments,
  canEdit,
  uploads,
}: TicketAttachmentsSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [viewedIndex, setViewedIndex] = useState<number | null>(null);
  const imageAttachments = attachments.filter(
    (attachment) => attachment.isEmbeddable,
  );
  const images = imageAttachments.map(toViewerImage);

  function viewHandlerFor(attachment: WorkItemAttachment): (() => void) | null {
    const index = imageAttachments.indexOf(attachment);

    return index === -1 ? null : () => setViewedIndex(index);
  }

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
              onView={viewHandlerFor(attachment)}
            />
          ))}
        </ul>
      )}
      {viewedIndex !== null && images[viewedIndex] ? (
        <ImageViewer
          images={images}
          index={viewedIndex}
          onClose={() => setViewedIndex(null)}
          onIndexChange={setViewedIndex}
        />
      ) : null}
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
