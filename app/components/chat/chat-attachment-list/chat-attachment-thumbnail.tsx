import { useState } from "react";
import { useTranslation } from "react-i18next";

import { chatAttachmentImageUrl } from "@/app/lib/chat-client";
import { CHAT_DOCUMENT_BYTES, chatPreviewKind } from "@/definition/ChatPreview";

import { attachmentIcon, attachmentTypeLabel } from "./attachment-type";
import { useAttachmentPreview } from "./use-attachment-preview";
import { pdfFailure, usePdfPage } from "./use-pdf-page";

import type { ChatAttachment } from "@/definition/Chat";
import type { ChatAttachmentPreview } from "@/definition/ChatPreview";

interface ThumbnailProps {
  readonly attachment: ChatAttachment;
  /** Whether the card is near the visible part of the conversation. */
  readonly isInView: boolean;
}

/** Width of a PDF page in a card, in CSS pixels. */
const PDF_THUMBNAIL_WIDTH = 160;

/** Lines of a text shown in a card. */
const EXCERPT_LINES = 7;

/** An icon with the type and a short reason, for files without a shown content. */
export function AttachmentPlaceholder({
  attachment,
  reason,
}: {
  readonly attachment: Pick<ChatAttachment, "fileName" | "contentType">;
  readonly reason: string | null;
}): React.ReactElement {
  const Icon = attachmentIcon(attachment.contentType);
  return (
    <span className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center text-muted-foreground">
      <Icon aria-hidden="true" className="size-6" />
      <span className="text-[0.6875rem] font-semibold tracking-wide">
        {attachmentTypeLabel(attachment.fileName)}
      </span>
      {reason ? (
        <span className="line-clamp-2 text-[0.625rem] leading-tight">
          {reason}
        </span>
      ) : null}
    </span>
  );
}

function ImageThumbnail({ attachment }: ThumbnailProps): React.ReactElement {
  const { t } = useTranslation();
  const [isBroken, setIsBroken] = useState(false);
  if (isBroken)
    return (
      <AttachmentPlaceholder
        attachment={attachment}
        reason={t("chat.files.unavailable.failed")}
      />
    );
  return (
    <img
      alt={t("chat.files.imageAlt", { name: attachment.fileName })}
      className="size-full object-contain"
      decoding="async"
      loading="lazy"
      onError={() => setIsBroken(true)}
      src={chatAttachmentImageUrl(attachment.id)}
    />
  );
}

function PdfThumbnail({
  attachment,
  isInView,
}: ThumbnailProps): React.ReactElement {
  const { t } = useTranslation();
  const isTooLarge = attachment.size > CHAT_DOCUMENT_BYTES;
  const page = usePdfPage({
    id: attachment.id,
    page: 1,
    width: PDF_THUMBNAIL_WIDTH,
    isWanted: isInView && !isTooLarge,
  });
  if (isTooLarge || page.status === "failed" || page.status === "encrypted")
    return (
      <AttachmentPlaceholder
        attachment={attachment}
        reason={t(pdfFailure(isTooLarge, page.status))}
      />
    );
  return (
    <span className="relative flex size-full items-start justify-center overflow-hidden bg-surface">
      <canvas
        ref={page.canvas}
        aria-label={t("chat.files.pdfPage", {
          page: 1,
          count: page.pageCount ?? 1,
        })}
        className="h-auto w-full"
        role="img"
      />
      {page.status === "loading" ? (
        <span className="absolute inset-0 flex items-center justify-center text-[0.6875rem] text-muted-foreground">
          {t("chat.files.loading")}
        </span>
      ) : null}
    </span>
  );
}

/** The first lines of a text, the first cells of a table or the start of a document. */
function previewExcerpt(preview: ChatAttachmentPreview): string | null {
  if (preview.kind === "text") return preview.text;
  if (preview.kind === "table")
    return preview.rows
      .slice(0, EXCERPT_LINES)
      .map((row) => row.slice(0, 4).join(" · "))
      .join("\n");
  if (preview.kind === "sections") return preview.sections[0]?.text ?? "";
  return null;
}

function ContentThumbnail({
  attachment,
  isInView,
}: ThumbnailProps): React.ReactElement {
  const { t } = useTranslation();
  const { preview, error } = useAttachmentPreview(attachment.id, isInView);
  if (error !== null)
    return (
      <AttachmentPlaceholder
        attachment={attachment}
        reason={t("chat.files.unavailable.failed")}
      />
    );
  if (preview === null)
    return <AttachmentPlaceholder attachment={attachment} reason={null} />;
  const excerpt = previewExcerpt(preview);
  if (excerpt === null || preview.kind === "unavailable")
    return (
      <AttachmentPlaceholder
        attachment={attachment}
        reason={
          preview.kind === "unavailable"
            ? t(`chat.files.unavailable.${preview.reason}`)
            : null
        }
      />
    );
  return (
    <span className="block size-full overflow-hidden bg-surface px-2 py-1.5 text-left">
      <span className="line-clamp-6 font-mono text-[0.625rem] leading-snug whitespace-pre-wrap text-foreground">
        {excerpt.split("\n").slice(0, EXCERPT_LINES).join("\n")}
      </span>
    </span>
  );
}

/**
 * The preview inside a card: the image, the first page of a PDF, the start of
 * a text, table or document, or the type with the reason it has none.
 */
export function ChatAttachmentThumbnail({
  attachment,
  isInView,
}: ThumbnailProps): React.ReactElement {
  const { t } = useTranslation();
  switch (chatPreviewKind(attachment.contentType)) {
    case "image":
      return <ImageThumbnail attachment={attachment} isInView={isInView} />;
    case "pdf":
      return <PdfThumbnail attachment={attachment} isInView={isInView} />;
    case "content":
      return <ContentThumbnail attachment={attachment} isInView={isInView} />;
    case "none":
      return (
        <AttachmentPlaceholder
          attachment={attachment}
          reason={t("chat.files.noPreview")}
        />
      );
  }
}
