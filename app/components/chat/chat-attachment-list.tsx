import { Paperclip, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatBytes } from "@/app/lib/format-bytes";

import type { ChatAttachment } from "@/definition/Chat";

interface ChatAttachmentListProps {
  readonly attachments: readonly ChatAttachment[];
  /** Removes an unsent attachment; sent attachments are links to download. */
  readonly onRemove?: (id: string) => void;
}

/** Attachments as chips: links to the download, or removable before sending. */
export function ChatAttachmentList({
  attachments,
  onRemove,
}: ChatAttachmentListProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (attachments.length === 0) return null;
  return (
    <ul
      className="mt-1.5 flex flex-wrap gap-1.5"
      aria-label={t("chat.attachments")}
    >
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
        >
          <Paperclip aria-hidden="true" className="size-3 shrink-0" />
          {onRemove ? (
            <span className="truncate">{attachment.fileName}</span>
          ) : (
            <a
              className="truncate underline"
              download
              href={`/chat/attachments/${attachment.id}`}
            >
              {attachment.fileName}
            </a>
          )}
          <span className="shrink-0 text-muted-foreground">
            {formatBytes(attachment.size)}
          </span>
          {onRemove ? (
            <button
              aria-label={t("chat.removeAttachment", {
                name: attachment.fileName,
              })}
              className="rounded-full p-0.5 hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => onRemove(attachment.id)}
              type="button"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
