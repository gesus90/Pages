import { FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { downloadUrl, formatFileSize } from "./card-types";
import {
  CardAction,
  CardActionDivider,
  CardDownloadAction,
  CardHead,
} from "./content-card";
import { DocumentPanel } from "./documents/document-panel";
import { DOCUMENT_ICONS, documentKindLabel } from "./documents/document-labels";
import { PdfViewer } from "./pdf-viewer";
import { useRetention } from "./use-retention";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { OpenedCard } from "./card-types";
import type { DocumentCardDescriptor } from "./documents/document-card";

/** A card the dark document viewer opens: a PDF or a read document. */
export interface DocumentViewerCard extends OpenedCard {
  readonly descriptor:
    | DocumentCardDescriptor
    | { readonly kind: "pdf"; readonly attachment: ConversationAttachment };
}

/**
 * Tells whether the full screen of a card is the dark document viewer
 * PDFs, texts, slides and tables.
 * @param card - The opened card.
 */
export function isDocumentViewerCard(
  card: OpenedCard,
): card is DocumentViewerCard {
  return ["pdf", "word", "slides", "sheet"].includes(card.descriptor.kind);
}

/**
 * The full screen of a document: the same view as next to the
 * chat on the dark surface of the viewer, the shared head with
 * "Herunterladen" in the accent color, the line and "Schließen". A PDF and
 * slides turn with the arrow keys; Escape closes (see `CardOverlay`).
 */
export function DocumentViewer({
  card,
  onClose,
}: {
  readonly card: DocumentViewerCard;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { descriptor } = card;
  const { attachment } = descriptor;
  const retention = useRetention(attachment.expiresAt);
  const kind =
    descriptor.kind === "pdf"
      ? t("chatPage.cards.kind.pdf")
      : documentKindLabel(descriptor.format, t);
  const subtitle = [
    kind,
    card.origin.senderName,
    formatFileSize(attachment.sizeBytes, i18n.language),
    retention,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  return (
    <div
      aria-label={t("chatPage.cards.viewer")}
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-viewer-scrim"
      data-document-viewer={descriptor.kind}
      role="dialog"
    >
      <CardHead
        actions={
          <>
            <CardDownloadAction
              download={{ href: downloadUrl(attachment) }}
              tone="dark"
            />
            <CardActionDivider tone="dark" />
            <CardAction
              icon={X}
              isIconOnly
              label={t("chatPage.cards.close")}
              onClick={onClose}
              tone="dark"
              variant="quiet"
            />
          </>
        }
        className="shrink-0 px-4"
        icon={
          descriptor.kind === "pdf" ? FileText : DOCUMENT_ICONS[descriptor.kind]
        }
        name={attachment.name}
        subtitle={subtitle}
        tone="dark"
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:mx-10 lg:mb-10 lg:rounded-2xl">
        {descriptor.kind === "pdf" ? (
          <PdfViewer
            className="min-h-0 flex-1"
            isFullscreen
            url={attachment.url}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col bg-panel-body">
            <DocumentPanel descriptor={descriptor} isFullscreen />
          </div>
        )}
      </div>
    </div>
  );
}
