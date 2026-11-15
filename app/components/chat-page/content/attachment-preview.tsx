import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { formatFileSize } from "./card-types";
import { useAttachmentPreview } from "./use-attachment-preview";

import type { LucideIcon } from "lucide-react";
import type { ConversationAttachment } from "@/definition/ConversationContent";

interface AttachmentPreviewButtonProps {
  readonly attachment: ConversationAttachment;
  /** The icon of the placeholder while there is no preview image. */
  readonly icon: LucideIcon;
  /** What a click does, as the accessible name, such as "Vollbild". */
  readonly label: string;
  readonly onOpen: () => void;
  /** Sizes and fits the preview image. */
  readonly imageClassName: string;
  /** Replaces the frame of the button, such as for a tile of a gallery (PAGE-382). */
  readonly className?: string;
  /** Hides the name and size of the placeholder, for a small tile. */
  readonly isCompact?: boolean;
}

/**
 * The preview image of an attachment as a button that opens it (PAGE-298).
 *
 * @remarks
 * Only the preview image loads here, never the original. Without one, a
 * placeholder names the file and its size while the browser creates the
 * preview (see {@link useAttachmentPreview}).
 */
export function AttachmentPreviewButton({
  attachment,
  icon: Icon,
  label,
  onOpen,
  imageClassName,
  className,
  isCompact = false,
}: AttachmentPreviewButtonProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const preview = useAttachmentPreview(attachment);
  return (
    <button
      ref={preview.target}
      aria-label={`${label}: ${attachment.name}`}
      className={cn(
        "block w-full cursor-pointer bg-panel-body focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
        className,
      )}
      data-attachment-preview={
        preview.previewUrl === null ? "missing" : "image"
      }
      onClick={onOpen}
      type="button"
    >
      {preview.previewUrl === null && isCompact ? (
        <span className="flex size-full items-center justify-center">
          <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
        </span>
      ) : null}
      {preview.previewUrl === null && !isCompact ? (
        <span className="flex min-h-36 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
          <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
          <span className="max-w-full truncate text-[13px] font-medium text-foreground">
            {attachment.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(attachment.sizeBytes, i18n.language)}
          </span>
          <span
            className="text-xs text-muted-foreground"
            role={preview.isPending ? "status" : undefined}
          >
            {preview.isPending
              ? t("chatPage.cards.previewPending")
              : t("chatPage.cards.noPreview")}
          </span>
        </span>
      ) : null}
      {preview.previewUrl === null ? null : (
        <img
          alt=""
          className={cn("mx-auto block", imageClassName)}
          decoding="async"
          loading="lazy"
          src={preview.previewUrl}
        />
      )}
    </button>
  );
}
