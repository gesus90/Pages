import { DocumentStateMessage } from "./document-state";
import { SheetPanel } from "./sheet-view";
import { SlidesPanel } from "./slides-view";
import { useDocument } from "./use-document";
import { WordPanel } from "./word-view";

import type { DocumentCardDescriptor } from "./document-card";

interface DocumentPanelProps {
  readonly descriptor: DocumentCardDescriptor;
  /** Shown in the full screen: the arrow keys turn slides. */
  readonly isFullscreen?: boolean;
}

/**
 * The whole document next to the chat and in the full screen (PAGE-385): a
 * text with its table of contents, the slides with their strip, or the table
 * with tabs, search, sorting and sums; all with a search.
 */
export function DocumentPanel({ descriptor, isFullscreen = false }: DocumentPanelProps): React.ReactElement {
  const { attachment, format } = descriptor;
  const state = useDocument({ url: attachment.url, format, name: attachment.name }, true);
  if (state.status !== "ready") return <DocumentStateMessage className="m-auto" state={state} />;
  const { document } = state;
  switch (document.kind) {
    case "word":
      return <WordPanel document={document} />;
    case "slides":
      return <SlidesPanel document={document} isFullscreen={isFullscreen} />;
    case "sheet":
      return <SheetPanel document={document} />;
  }
}
