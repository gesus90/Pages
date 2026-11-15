import { useTranslation } from "react-i18next";

import { downloadUrl, formatFileSize } from "../card-types";
import { useChatContent } from "../chat-content-context";
import { ContentCard } from "../content-card";
import { useRetention } from "../use-retention";

import {
  DOCUMENT_ICONS,
  documentExtent,
  documentKindLabel,
} from "./document-labels";
import { DocumentStateMessage } from "./document-state";
import { SheetPreview } from "./sheet-view";
import { SlidesPreview } from "./slides-view";
import { useDocument } from "./use-document";
import { WordPreview } from "./word-view";

import type { OpenedCard } from "../card-types";
import type { ReadDocument } from "./document-model";

/** A card of a document as the split view and the full screen open it. */
export type DocumentCardDescriptor = Extract<
  OpenedCard["descriptor"],
  { readonly kind: "word" | "slides" | "sheet" }
>;

interface DocumentCardProps {
  readonly card: OpenedCard & { readonly descriptor: DocumentCardDescriptor };
}

/** The start of a read document, by its kind. */
function DocumentPreview({
  document,
  onOpen,
}: {
  readonly document: ReadDocument;
  readonly onOpen: () => void;
}): React.ReactElement {
  switch (document.kind) {
    case "word":
      return <WordPreview document={document} onOpen={onOpen} />;
    case "slides":
      return <SlidesPreview document={document} onOpen={onOpen} />;
    case "sheet":
      return <SheetPreview document={document} onOpen={onOpen} />;
  }
}

/**
 * The card of a Word, PowerPoint, OpenDocument or table file (PAGE-385), in
 * the head every content card shares: "Herunterladen" in the accent color,
 * the line, "Daneben", "Vollbild" and "Zuklappen".
 *
 * @remarks
 * Expanded, the card shows the start of the document in the Pages design:
 * the first page of a text, one slide at a time, or the first rows of a
 * table. The original loads only while the card is expanded or opened, and
 * is read in the browser; nothing of it runs.
 */
export function DocumentCard({ card }: DocumentCardProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const content = useChatContent();
  const { attachment, format, kind } = card.descriptor;
  const isExpanded = content.stateOf(card.key, "expanded") === "expanded";
  const state = useDocument(
    { url: attachment.url, format, name: attachment.name },
    isExpanded,
  );
  const retention = useRetention(attachment.expiresAt);
  const extent = documentExtent(
    state.status === "ready" ? state.document : null,
    t,
  );
  const size = formatFileSize(attachment.sizeBytes, i18n.language);

  function handleOpen(): void {
    content.openBeside(card);
  }

  return (
    <ContentCard
      beside={card}
      cardKey={card.key}
      className="max-w-2xl"
      defaultState="expanded"
      download={{ href: downloadUrl(attachment) }}
      icon={DOCUMENT_ICONS[kind]}
      kindLabel={documentKindLabel(format, t)}
      meta={extent === "" ? size : `${extent} · ${size}`}
      name={attachment.name}
      onFullscreen={() => content.openOverlay(card)}
      retention={retention}
    >
      {state.status === "ready" ? (
        <DocumentPreview document={state.document} onOpen={handleOpen} />
      ) : (
        <DocumentStateMessage state={state} />
      )}
    </ContentCard>
  );
}
