import { BookOpen, Download, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AttachmentPreviewButton } from "./attachment-preview";
import { downloadUrl, formatFileSize } from "./card-types";
import { useChatContent } from "./chat-content-context";
import { CardAction, ContentCard } from "./content-card";

import type { OpenedCard } from "./card-types";

interface PdfCardProps {
  /** The card of the PDF, as the split view and the viewer open it. */
  readonly card: OpenedCard & { readonly descriptor: { readonly kind: "pdf" } };
}

/**
 * The card of a PDF of a message (PAGE-298): collapsed to one line by
 * default; expanded it shows the preview of the first page with Öffnen,
 * Laden and Daneben. The document itself loads only in the viewer.
 */
export function PdfCard({ card }: PdfCardProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const content = useChatContent();
  const { attachment } = card.descriptor;
  const open = (): void => content.openOverlay(card);
  return (
    <ContentCard
      actions={
        <>
          <CardAction
            icon={BookOpen}
            label={t("chatPage.cards.open")}
            onClick={open}
          />
          <CardAction
            href={downloadUrl(attachment)}
            icon={Download}
            label={t("chatPage.cards.download")}
          />
        </>
      }
      beside={card}
      cardKey={card.key}
      className="max-w-lg"
      defaultState="collapsed"
      icon={FileText}
      kindLabel={t("chatPage.cards.kind.pdf")}
      meta={formatFileSize(attachment.sizeBytes, i18n.language)}
      name={attachment.name}
    >
      <AttachmentPreviewButton
        attachment={attachment}
        icon={FileText}
        imageClassName="max-h-72 w-auto max-w-full object-contain py-3"
        label={t("chatPage.cards.open")}
        onOpen={open}
      />
    </ContentCard>
  );
}
