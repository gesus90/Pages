import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, buttonVariants } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  chatAttachmentImageUrl,
  chatAttachmentUrl,
} from "@/app/lib/chat-client";
import { formatBytes } from "@/app/lib/format-bytes";
import { CHAT_DOCUMENT_BYTES, chatPreviewKind } from "@/definition/ChatPreview";

import { attachmentTypeLabel } from "./attachment-type";
import { useAttachmentPreview } from "./use-attachment-preview";
import { pdfFailure, usePdfPage } from "./use-pdf-page";

import type { RefObject } from "react";
import type { ChatAttachment } from "@/definition/Chat";
import type { ChatAttachmentPreview } from "@/definition/ChatPreview";

interface ChatAttachmentViewerProps {
  readonly attachment: ChatAttachment;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The control that opened the view; it gets the focus back on closing. */
  readonly returnFocus: RefObject<HTMLElement | null>;
}

/** Width of a PDF page in the viewer, in CSS pixels; narrow screens scale it down. */
const PDF_VIEWER_WIDTH = 560;

function Notice({ text }: { readonly text: string }): React.ReactElement {
  return (
    <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function PdfViewer({
  attachment,
}: {
  readonly attachment: ChatAttachment;
}): React.ReactElement {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const isTooLarge = attachment.size > CHAT_DOCUMENT_BYTES;
  const pdf = usePdfPage({
    id: attachment.id,
    page,
    width: PDF_VIEWER_WIDTH,
    isWanted: !isTooLarge,
  });
  if (isTooLarge || pdf.status === "failed" || pdf.status === "encrypted")
    return <Notice text={t(pdfFailure(isTooLarge, pdf.status))} />;
  const count = pdf.pageCount ?? 1;
  return (
    <div className="space-y-2">
      <div className="max-h-[60dvh] overflow-auto rounded-lg bg-muted p-2">
        <canvas
          ref={pdf.canvas}
          aria-label={t("chat.files.pdfPage", { page, count })}
          className="mx-auto h-auto w-full max-w-[35rem] bg-surface shadow-sm"
          role="img"
        />
      </div>
      <div className="flex items-center justify-center gap-2 text-sm">
        <Button
          aria-label={t("chat.files.previousPage")}
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          size="icon"
          variant="outline"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </Button>
        <span aria-live="polite">
          {pdf.status === "loading"
            ? t("chat.files.loading")
            : t("chat.files.pdfPage", { page, count })}
        </span>
        <Button
          aria-label={t("chat.files.nextPage")}
          disabled={page >= count}
          onClick={() => setPage(page + 1)}
          size="icon"
          variant="outline"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function TablePreview({
  preview,
}: {
  readonly preview: Extract<ChatAttachmentPreview, { kind: "table" }>;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="max-h-[60dvh] overflow-auto rounded-lg ring-1 ring-border">
      <table className="min-w-full border-collapse text-xs">
        {preview.sheet ? (
          <caption className="bg-muted px-2 py-1 text-left font-medium">
            {t("chat.files.sheet", { name: preview.sheet })}
          </caption>
        ) : null}
        <tbody>
          {preview.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-surface even:bg-muted/60">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="border-b border-border px-2 py-1 align-top whitespace-pre-wrap"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContentPreview({
  attachment,
}: {
  readonly attachment: ChatAttachment;
}): React.ReactElement {
  const { t } = useTranslation();
  const { preview, error } = useAttachmentPreview(attachment.id, true);
  if (error !== null)
    return <Notice text={t("chat.files.unavailable.failed")} />;
  if (preview === null) return <Notice text={t("chat.files.loading")} />;
  if (preview.kind === "unavailable")
    return <Notice text={t(`chat.files.unavailable.${preview.reason}`)} />;
  return (
    <div className="space-y-2">
      {preview.kind === "table" ? <TablePreview preview={preview} /> : null}
      {preview.kind === "text" ? (
        <pre className="max-h-[60dvh] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {preview.text}
        </pre>
      ) : null}
      {preview.kind === "sections" ? (
        <div className="max-h-[60dvh] space-y-3 overflow-auto rounded-lg bg-muted p-3 text-sm">
          {preview.sections.map((section) => (
            <section key={`${section.kind}-${section.number}`}>
              {section.kind === "document" ? null : (
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                  {t(`chat.files.section.${section.kind}`, {
                    number: section.number,
                  })}
                </h3>
              )}
              <p className="whitespace-pre-wrap">{section.text}</p>
            </section>
          ))}
        </div>
      ) : null}
      {preview.isTruncated ? <Notice text={t("chat.files.truncated")} /> : null}
    </div>
  );
}

function ViewerBody({
  attachment,
}: {
  readonly attachment: ChatAttachment;
}): React.ReactElement {
  const { t } = useTranslation();
  switch (chatPreviewKind(attachment.contentType)) {
    case "image":
      return (
        <div className="flex max-h-[65dvh] justify-center overflow-auto rounded-lg bg-muted p-2">
          <img
            alt={t("chat.files.imageAlt", { name: attachment.fileName })}
            className="h-auto max-h-[62dvh] w-auto max-w-full object-contain"
            src={chatAttachmentImageUrl(attachment.id)}
          />
        </div>
      );
    case "pdf":
      return <PdfViewer attachment={attachment} />;
    case "content":
      return <ContentPreview attachment={attachment} />;
    case "none":
      return <Notice text={t("chat.files.noPreview")} />;
  }
}

/**
 * The larger, accessible view of an attachment with its name, type, size,
 * origin and an explicit download (PAGE-92).
 *
 * @remarks
 * The dialog keeps the focus inside, closes with Escape or its button and
 * returns the focus to the card. Its content is plain text, a drawn PDF page
 * or an image from the owner-bound preview address of Pages.
 */
export function ChatAttachmentViewer({
  attachment,
  isOpen,
  onOpenChange,
  returnFocus,
}: ChatAttachmentViewerProps): React.ReactElement {
  const { t } = useTranslation();
  const facts = [
    attachmentTypeLabel(attachment.fileName),
    formatBytes(attachment.size),
    attachment.origin === "assistant"
      ? t("chat.files.fromPica")
      : t("chat.files.fromYou"),
  ];
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-3 overflow-hidden p-4 sm:p-5"
        onCloseAutoFocus={(event) => {
          // The dialog opens without a Radix trigger, so the card takes the focus back itself.
          event.preventDefault();
          returnFocus.current?.focus();
        }}
        size="lg"
      >
        <div className="min-w-0">
          <DialogTitle className="truncate text-base font-semibold">
            {attachment.fileName}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {facts.join(" · ")}
          </DialogDescription>
        </div>
        {isOpen ? <ViewerBody attachment={attachment} /> : null}
        <div className="flex justify-end gap-2">
          <a
            className={buttonVariants({ variant: "outline" })}
            download
            href={chatAttachmentUrl(attachment.id)}
          >
            <Download aria-hidden="true" className="size-4" />
            {t("chat.files.downloadButton")}
          </a>
          <DialogClose asChild>
            <Button>{t("chat.files.close")}</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
