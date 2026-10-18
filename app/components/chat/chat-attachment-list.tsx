import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { ChatAttachmentCard } from "./chat-attachment-list/chat-attachment-card";
import { ChatUploadCard } from "./chat-attachment-list/chat-upload-card";

import type { ChatAttachment } from "@/definition/Chat";
import type { ChatUploadItem } from "./use-chat-uploads";

interface ChatAttachmentListProps {
  readonly attachments: readonly ChatAttachment[];
  /** Removes an unsent attachment; sent attachments open and download. */
  readonly onRemove?: (id: string) => void;
  /** Files of the next message that upload or failed, after the stored ones. */
  readonly uploads?: readonly ChatUploadItem[];
  readonly onRetry?: (key: string) => void;
  readonly onDismiss?: (key: string) => void;
  /** The input field shows smaller cards in one scrolling row. */
  readonly isCompact?: boolean;
}

/** Cards a message shows before the rest is unfolded, so many files keep the conversation short. */
const FOLDED_CARDS = 4;

/**
 * Attachments as preview cards (PAGE-92): images, PDF pages, the start of
 * texts, tables and documents, each with name, type, size and a download.
 * The same cards show the files chosen for the next message, with their
 * upload state, and the files of sent messages and of Pica's answers.
 */
export function ChatAttachmentList({
  attachments,
  onRemove,
  uploads = [],
  onRetry,
  onDismiss,
  isCompact = false,
}: ChatAttachmentListProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [isUnfolded, setIsUnfolded] = useState(false);
  if (attachments.length === 0 && uploads.length === 0) return null;
  const isFolded =
    !isCompact && !isUnfolded && attachments.length > FOLDED_CARDS + 1;
  const shown = isFolded ? attachments.slice(0, FOLDED_CARDS) : attachments;
  return (
    <>
      <ul
        className={cn(
          "mt-1.5 flex gap-2",
          isCompact ? "pages-thin-scrollbar overflow-x-auto pb-1" : "flex-wrap",
        )}
        aria-label={t("chat.attachments")}
      >
        {shown.map((attachment) => (
          <ChatAttachmentCard
            key={attachment.id}
            attachment={attachment}
            isCompact={isCompact}
            onRemove={onRemove}
          />
        ))}
        {uploads.map((item) => (
          <ChatUploadCard
            key={item.key}
            item={item}
            onDismiss={(key) => onDismiss?.(key)}
            onRetry={(key) => onRetry?.(key)}
          />
        ))}
      </ul>
      {!isCompact && attachments.length > FOLDED_CARDS + 1 ? (
        <button
          aria-expanded={!isFolded}
          className="mt-1.5 rounded-md px-1 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() => setIsUnfolded(!isUnfolded)}
          type="button"
        >
          {isFolded
            ? t("chat.files.showAll", { count: attachments.length })
            : t("chat.files.showFewer")}
        </button>
      ) : null}
    </>
  );
}
