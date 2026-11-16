import { DocumentView } from "@/app/components/chat-page/content/documents/document-panel";

import { StorageMarkdownView } from "./storage-markdown-view";
import {
  StoragePreviewLoading,
  StoragePreviewOutcomeNotice,
} from "./storage-preview-notices";
import { StoragePdfView } from "./storage-pdf-view";
import { StorageTextView } from "./storage-text-view";

import type { StoragePreviewContent } from "./storage-preview-content";
import type { StoragePreviewOutcome } from "./storage-preview-load";

function StoragePreviewContentView({
  content,
  label,
}: {
  readonly content: StoragePreviewContent;
  readonly label: string;
}): React.ReactElement {
  switch (content.kind) {
    case "markdown":
      return <StorageMarkdownView label={label} source={content.text} />;
    case "text":
      return <StorageTextView label={label} text={content.text} />;
    case "pdf":
      return <StoragePdfView label={label} preview={content.preview} />;
    case "document":
      return <DocumentView document={content.document} />;
  }
}

/**
 * The body of the preview under its head: the placeholder while the file
 * loads, its content, or the notice of why there is none.
 */
export function StoragePreviewBody({
  outcome,
  label,
  downloadHref,
  onRetry,
}: {
  /** How loading ended; `null` while it is under way. */
  readonly outcome: StoragePreviewOutcome | null;
  readonly label: string;
  readonly downloadHref: string | null;
  readonly onRetry: () => void;
}): React.ReactElement {
  if (outcome === null) return <StoragePreviewLoading />;

  if (outcome.kind !== "ready") {
    return (
      <StoragePreviewOutcomeNotice
        downloadHref={downloadHref}
        onRetry={onRetry}
        outcome={outcome}
      />
    );
  }

  return <StoragePreviewContentView content={outcome.content} label={label} />;
}
