import { FileText, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AttachmentPreviewButton } from "./attachment-preview";
import { downloadUrl, formatFileSize } from "./card-types";
import { useChatContent } from "./chat-content-context";
import { ContentCard } from "./content-card";
import { usePdfFacts } from "./pdf-facts";
import { useRetention } from "./use-retention";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { OpenedCard } from "./card-types";

interface PdfCardProps {
  /** The card of the PDF, as the split view and the viewer open it. */
  readonly card: OpenedCard & { readonly descriptor: { readonly kind: "pdf" } };
}

interface PdfSummaryProps {
  readonly attachment: ConversationAttachment;
  readonly onOpen: () => void;
}

/**
 * The small preview of the first page with title, page count and "Öffnen";
 * an encrypted PDF names that it stays downloadable.
 */
function PdfSummary({
  attachment,
  onOpen,
}: PdfSummaryProps): React.ReactElement {
  const { t } = useTranslation();
  const facts = usePdfFacts(attachment);
  return (
    <div className="flex items-stretch gap-4 p-3" data-pdf-summary="">
      <AttachmentPreviewButton
        attachment={attachment}
        className="w-28 shrink-0 overflow-hidden rounded-md border border-border sm:w-32"
        icon={FileText}
        imageClassName="h-auto w-full object-contain"
        isCompact
        label={t("chatPage.cards.open")}
        onOpen={onOpen}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <p
          className="line-clamp-2 text-sm font-semibold text-foreground"
          data-pdf-title=""
        >
          {facts.title ?? attachment.name}
        </p>
        {facts.pageCount === undefined ? null : (
          <p className="text-xs text-muted-foreground">
            {t("chatPage.cards.document.pages", { count: facts.pageCount })}
          </p>
        )}
        {facts.isEncrypted === true ? (
          <p
            className="flex items-start gap-1.5 text-xs text-muted-foreground"
            role="note"
          >
            <Lock
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-primary"
            />
            {t("chatPage.cards.pdf.encrypted")}
          </p>
        ) : (
          <button
            className="self-start text-xs font-medium text-primary hover:underline"
            onClick={onOpen}
            type="button"
          >
            {t("chatPage.cards.open")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The card of a PDF of a message: a small preview of
 * the first page with the title from the metadata (else the file name), the
 * page count and "Öffnen", in the shared head with Herunterladen, Daneben,
 * Vollbild and Zuklappen. The document itself loads only in the viewer.
 */
export function PdfCard({ card }: PdfCardProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const content = useChatContent();
  const { attachment } = card.descriptor;
  const facts = usePdfFacts(attachment);
  const retention = useRetention(attachment.expiresAt);
  const size = formatFileSize(attachment.sizeBytes, i18n.language);
  const open = (): void => content.openOverlay(card);
  return (
    <ContentCard
      beside={card}
      cardKey={card.key}
      className="max-w-lg"
      defaultState="expanded"
      download={{ href: downloadUrl(attachment) }}
      icon={FileText}
      kindLabel={t("chatPage.cards.kind.pdf")}
      meta={
        facts.pageCount === undefined
          ? size
          : `${t("chatPage.cards.document.pages", { count: facts.pageCount })} · ${size}`
      }
      name={attachment.name}
      onFullscreen={open}
      retention={retention}
    >
      <PdfSummary attachment={attachment} onOpen={open} />
    </ContentCard>
  );
}
