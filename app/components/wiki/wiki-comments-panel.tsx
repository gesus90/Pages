import { MessageSquareQuote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { WikiCommentComposer } from "@/app/components/wiki/wiki-comment-composer";
import { WikiCommentThreadView } from "@/app/components/wiki/wiki-comment-thread";
import { cn } from "@/app/lib/cn";

import type { QuoteReference } from "@/app/lib/wiki-highlight";
import type { WikiCommentThread } from "@/definition/Wiki";

interface WikiCommentsPanelProps {
  readonly pageId: string;
  readonly threads: readonly WikiCommentThread[];
  /** The passage currently selected in the page, if any. */
  readonly selection: QuoteReference | null;
  /**
   * A passage the editor asked to comment on (its toolbar button); a new
   * request object starts a new comment.
   */
  readonly requestedQuote?: { readonly quote: QuoteReference } | null;
  /** Every new number focuses the box for a new comment. */
  readonly focusRequest?: number;
  /** The comment a link points to (`#comment-<id>`), shown and scrolled to. */
  readonly targetCommentId?: string | null;
  /**
   * Whether the column beside the text is open. Below desktop width the
   * comments always stand at the end of the page.
   */
  readonly isOpen?: boolean;
  readonly id?: string;
}

interface CommentTarget {
  readonly threads: readonly WikiCommentThread[];
  readonly targetCommentId: string | null;
  readonly isOpen: boolean;
  readonly isShowingResolved: boolean;
  readonly showResolved: (isShown: boolean) => void;
}

/** Moves the focus into the box for a new comment once it is rendered. */
function focusComposer(panel: HTMLElement | null): void {
  window.requestAnimationFrame(() => {
    panel?.querySelector("textarea")?.focus();
  });
}

/**
 * Shows the comment a link points to, also inside a resolved thread, once
 * per link: later reloads of the comments do not scroll back to it. It waits
 * until the column is open and the thread is rendered.
 */
function useCommentTarget({
  threads,
  targetCommentId,
  isOpen,
  isShowingResolved,
  showResolved,
}: CommentTarget): void {
  const shownTarget = useRef<string | null>(null);

  useEffect(() => {
    if (targetCommentId === null || shownTarget.current === targetCommentId) {
      return;
    }

    const thread = threads.find(
      ({ comment, replies }) =>
        comment.id === targetCommentId ||
        replies.some((reply) => reply.id === targetCommentId),
    );

    if (thread !== undefined && thread.comment.resolvedAt !== null) {
      showResolved(true);
    }

    const element = document.getElementById(`comment-${targetCommentId}`);

    // A hidden column has no layout yet; the effect runs again once it opens.
    if (element === null || element.getClientRects().length === 0) {
      return;
    }

    shownTarget.current = targetCommentId;
    element.scrollIntoView({ block: "center" });
  }, [threads, targetCommentId, isOpen, isShowingResolved, showResolved]);
}

/**
 * The box for a new comment and the requests to start one: a passage the
 * editor asked to comment on, or "write comment"; both scroll to the box and
 * focus it.
 */
function useComposerRequests(
  panel: React.RefObject<HTMLElement | null>,
  requestedQuote: { readonly quote: QuoteReference } | null,
  focusRequest: number,
): {
  readonly quote: QuoteReference | null;
  readonly setQuote: (quote: QuoteReference | null) => void;
  readonly composerKey: number;
  readonly setComposerKey: (key: number) => void;
} {
  const [quote, setQuote] = useState<QuoteReference | null>(null);
  const [composerKey, setComposerKey] = useState(0);

  useEffect(() => {
    if (requestedQuote === null) {
      return;
    }

    setQuote(requestedQuote.quote);
    setComposerKey((key) => key + 1);
    panel.current?.scrollIntoView({ block: "nearest" });
    focusComposer(panel.current);
  }, [panel, requestedQuote]);

  useEffect(() => {
    if (focusRequest > 0) {
      panel.current?.scrollIntoView({ block: "nearest" });
      focusComposer(panel.current);
    }
  }, [panel, focusRequest]);

  return { composerKey, quote, setComposerKey, setQuote };
}

/** The comments of a page: a box for new ones, open threads, resolved ones. */
export function WikiCommentsPanel({
  pageId,
  threads,
  selection,
  requestedQuote = null,
  focusRequest = 0,
  targetCommentId = null,
  isOpen = true,
  id,
}: WikiCommentsPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [showResolved, setShowResolved] = useState(false);
  const panel = useRef<HTMLElement | null>(null);
  const { quote, setQuote, composerKey, setComposerKey } = useComposerRequests(
    panel,
    requestedQuote,
    focusRequest,
  );

  useCommentTarget({
    isOpen,
    isShowingResolved: showResolved,
    showResolved: setShowResolved,
    targetCommentId,
    threads,
  });

  const open = threads.filter((thread) => thread.comment.resolvedAt === null);
  const resolved = threads.filter(
    (thread) => thread.comment.resolvedAt !== null,
  );
  const shown = showResolved ? [...open, ...resolved] : open;

  return (
    <aside
      ref={panel}
      aria-label={t("wiki.comments.title")}
      className={cn("space-y-3", !isOpen && "xl:hidden")}
      id={id}
    >
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
