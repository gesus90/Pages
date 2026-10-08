import { MessageSquareQuote } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { WikiCommentComposer } from "@/app/components/wiki/wiki-comment-composer";
import { WikiCommentThreadView } from "@/app/components/wiki/wiki-comment-thread";

import type { QuoteReference } from "@/app/lib/wiki-highlight";
import type { WikiCommentThread } from "@/definition/Wiki";

interface WikiCommentsPanelProps {
  readonly pageId: string;
  readonly threads: readonly WikiCommentThread[];
  /** The passage currently selected in the page, if any. */
  readonly selection: QuoteReference | null;
}

/** The comments of a page: a box for new ones, open threads, resolved ones. */
export function WikiCommentsPanel({
  pageId,
  threads,
  selection,
}: WikiCommentsPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [quote, setQuote] = useState<QuoteReference | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
  const open = threads.filter((thread) => thread.comment.resolvedAt === null);
  const resolved = threads.filter(
    (thread) => thread.comment.resolvedAt !== null,
  );
  const shown = showResolved ? [...open, ...resolved] : open;

  return (
    <aside aria-label={t("wiki.comments.title")} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase">
          {t("wiki.comments.title")} ({open.length})
        </h2>
        {selection ? (
          <Button
            size="sm"
            variant="outline"
            // Keep the selection while the button is pressed.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuote(selection);
              setComposerKey(composerKey + 1);
            }}
          >
            <MessageSquareQuote aria-hidden="true" className="size-4" />
            {t("wiki.comments.commentSelection")}
          </Button>
        ) : null}
      </div>
      <WikiCommentComposer
        key={composerKey}
        label={t("wiki.comments.newLabel")}
        pageId={pageId}
        parentId={null}
        quote={quote}
        submitLabel={t("wiki.comments.submit")}
        onDone={() => setQuote(null)}
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("wiki.comments.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((thread) => (
            <WikiCommentThreadView
              key={thread.comment.id}
              pageId={pageId}
              thread={thread}
            />
          ))}
        </ul>
      )}
      {resolved.length > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowResolved(!showResolved)}
        >
          {t(
            showResolved
              ? "wiki.comments.hideResolved"
              : "wiki.comments.showResolved",
            {
              count: resolved.length,
            },
          )}
        </Button>
      ) : null}
    </aside>
  );
}
