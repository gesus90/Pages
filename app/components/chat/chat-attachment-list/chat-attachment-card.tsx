import { Download, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { chatAttachmentUrl } from "@/app/lib/chat-client";
import { cn } from "@/app/lib/cn";
import { formatBytes } from "@/app/lib/format-bytes";

import { attachmentIcon, attachmentTypeLabel } from "./attachment-type";
import { ChatAttachmentThumbnail } from "./chat-attachment-thumbnail";
import { ChatAttachmentViewer } from "./chat-attachment-viewer";
import { useInView } from "./use-in-view";

import type { ChatAttachment } from "@/definition/Chat";

interface ChatAttachmentCardProps {
  readonly attachment: ChatAttachment;
  /** Removes an unsent attachment; sent attachments only open and download. */
  readonly onRemove?: (id: string) => void;
  /** The smaller card of the input field. */
  readonly isCompact?: boolean;
}

/** The footer of a card: icon, name as download, type, size, origin and actions. */
export function CardFooter({
  name,
  facts,
  contentType,
  children,
}: {
  readonly name: React.ReactNode;
  readonly facts: string;
  readonly contentType: string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const Icon = attachmentIcon(contentType);
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      <Icon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-xs font-medium">{name}</p>
        <p className="truncate text-[0.6875rem] text-muted-foreground">
          {facts}
        </p>
      </div>
      {children}
    </div>
  );
}

/** The class of the small round actions of a card. */
export const CARD_ACTION =
  "shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary";

/** The remove action on the corner of a preview, so the name keeps its width. */
export const CARD_OVERLAY_ACTION =
  "absolute top-1 right-1 rounded-full bg-surface/90 p-1 text-foreground shadow-sm ring-1 ring-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary";

/**
 * One attachment as a card with its preview, name, type, size and origin
 * (PAGE-92). The preview opens the larger view; name and icon download.
 */
export function ChatAttachmentCard({
  attachment,
  onRemove,
  isCompact = false,
}: ChatAttachmentCardProps): React.ReactElement {
  const { t } = useTranslation();
  const [isViewing, setIsViewing] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const { ref, isInView } = useInView<HTMLLIElement>();
  const url = chatAttachmentUrl(attachment.id);
  const facts = [
    attachmentTypeLabel(attachment.fileName),
    formatBytes(attachment.size),
  ].join(" · ");
  return (
    <li
      ref={ref}
      className={cn(
        "flex shrink-0 flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-border",
        isCompact ? "w-36" : "w-32 sm:w-36",
      )}
    >
      <div className="relative">
        <button
          ref={opener}
          aria-label={t("chat.files.openPreview", {
            name: attachment.fileName,
          })}
          className={cn(
            "block w-full overflow-hidden bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
            isCompact ? "h-16" : "h-24",
          )}
          onClick={() => setIsViewing(true)}
          type="button"
        >
          <ChatAttachmentThumbnail
            attachment={attachment}
            isInView={isInView}
          />
        </button>
        {attachment.origin === "assistant" ? (
          <span className="pointer-events-none absolute bottom-1 left-1 rounded-md bg-surface/90 px-1.5 py-0.5 text-[0.625rem] font-semibold text-foreground ring-1 ring-border">
            {t("chat.files.fromPicaBadge")}
          </span>
        ) : null}
        {onRemove ? (
          <button
            aria-label={t("chat.removeAttachment", {
              name: attachment.fileName,
            })}
            className={CARD_OVERLAY_ACTION}
            onClick={() => onRemove(attachment.id)}
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>
      <CardFooter
        contentType={attachment.contentType}
        facts={facts}
        name={
          <a
            className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            download
            href={url}
          >
            {attachment.fileName}
          </a>
        }
      >
        {isCompact ? null : (
          <a
            aria-label={t("chat.files.download", {
              name: attachment.fileName,
            })}
            className={CARD_ACTION}
            download
            href={url}
            title={t("chat.files.downloadButton")}
          >
            <Download aria-hidden="true" className="size-3.5" />
          </a>
        )}
      </CardFooter>
      <ChatAttachmentViewer
        attachment={attachment}
        isOpen={isViewing}
        onOpenChange={setIsViewing}
        returnFocus={opener}
      />
    </li>
  );
}
