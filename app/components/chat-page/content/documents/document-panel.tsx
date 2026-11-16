import { DocumentStateMessage } from "./document-state";
import { SheetPanel } from "./sheet-view";
import { SlidesPanel } from "./slides-view";
import { useDocument } from "./use-document";
import { WordPanel } from "./word-view";

import type { DocumentCardDescriptor } from "./document-card";
import type { ReadDocument } from "./document-model";

interface DocumentPanelProps {
  readonly descriptor: DocumentCardDescriptor;
  /** Shown in the full screen: the arrow keys turn slides. */
  readonly isFullscreen?: boolean;
}

interface DocumentViewProps {
  readonly document: ReadDocument;
  /** Shown in the full screen: the arrow keys turn slides. */
  readonly isFullscreen?: boolean;
}

/**
 * The whole view of a document that is already read, by its kind. Other
 * surfaces than the chat show a document through it, since it needs no chat
 * context.
 */
export function DocumentView({
  document,
  isFullscreen = false,
}: DocumentViewProps): React.ReactElement {
  switch (document.kind) {
    case "word":
      return <WordPanel document={document} />;
    case "slides":
      return <SlidesPanel document={document} isFullscreen={isFullscreen} />;
    case "sheet":
      return <SheetPanel document={document} />;
  }
}

/**
 * The whole document next to the chat and in the full screen: a
 * text with its table of contents, the slides with their strip, or the table
 * with tabs, search, sorting and sums; all with a search.
 */
export function DocumentPanel({
  descriptor,
  isFullscreen = false,
}: DocumentPanelProps): React.ReactElement {
  const { attachment, format } = descriptor;
  const state = useDocument(
    { url: attachment.url, format, name: attachment.name },
    true,
  );
  if (state.status !== "ready")
    return <DocumentStateMessage className="m-auto" state={state} />;
  return <DocumentView document={state.document} isFullscreen={isFullscreen} />;
}
