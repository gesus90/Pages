import { File as FileIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
  CONVERSATION_ATTACHMENT_MAXIMUM_COUNT,
} from "@/definition/ConversationContent";

import { formatFileSize } from "./content/card-types";

import type {
  AttachmentUploads,
  PendingAttachment,
} from "./use-attachment-uploads";

/** What stands below the name: the progress, a failure, or the size alone. */
function AttachmentStatus({
  item,
}: {
  readonly item: PendingAttachment;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const size = formatFileSize(item.sizeBytes, i18n.language);
  if (item.state === "failed")
    return (
      <span className="truncate text-xs text-destructive">
        {t("chatPage.attach.failed")}
      </span>
    );
  if (item.state === "ready")
    return (
      <span className="truncate text-xs text-muted-foreground">{size}</span>
    );
  const percent = Math.round(item.progress * 100);
  return (
    <>
      <span className="truncate text-xs text-muted-foreground">
        {t("chatPage.attach.uploading", { size, percent })}
      </span>
      <span
        aria-label={t("chatPage.attach.progress", { name: item.name })}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <span
          className="block h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${String(percent)}%` }}
        />
      </span>
    </>
  );
}

/** One attachment of the message being written: preview, name, state and "Entfernen". */
function AttachmentItem({
  item,
  onRemove,
}: {
  readonly item: PendingAttachment;
  onRemove(localId: string): void;
}): React.ReactElement {
  const { t } = useTranslation();
  const removeLabel = t("chatPage.attach.remove", { name: item.name });
  return (
    <li className="flex w-56 shrink-0 items-center gap-2 rounded-[10px] border border-border bg-panel-body p-1.5">
      {item.previewUrl === null ? (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FileIcon aria-hidden="true" className="size-4" />
        </span>
      ) : (
        <img
          alt=""
          className="size-10 shrink-0 rounded-md bg-muted object-cover"
          src={item.previewUrl}
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {item.name}
        </span>
        <AttachmentStatus item={item} />
      </span>
      <button
        aria-label={removeLabel}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => onRemove(item.localId)}
        title={removeLabel}
        type="button"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}

/**
 * The attachments of the message being written, above the input field of
 * the composer (PAGE-298), with the reason a file was refused.
 */
export function ChatPageAttachmentStrip({
  uploads,
}: {
  readonly uploads: AttachmentUploads;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  if (uploads.items.length === 0 && uploads.failure === null) return null;
  return (
    <div className="mb-2 flex flex-col gap-2">
      {uploads.items.length > 0 ? (
        <ul
          aria-label={t("chatPage.attach.list")}
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {uploads.items.map((item) => (
            <AttachmentItem
              key={item.localId}
              item={item}
              onRemove={uploads.remove}
            />
          ))}
        </ul>
      ) : null}
      {uploads.failure ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`chatPage.attach.failure.${uploads.failure}`, {
            maximum: formatFileSize(
              CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
              i18n.language,
            ),
            limit: CONVERSATION_ATTACHMENT_MAXIMUM_COUNT,
          })}
        </p>
      ) : null}
    </div>
  );
}
