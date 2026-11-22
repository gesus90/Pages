import { MessageSquareQuote } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { useCommentHighlights } from "@/app/components/wiki/use-comment-highlights";
import { useWikiSelection } from "@/app/components/wiki/use-wiki-selection";
import { WikiAnchorsDialog } from "@/app/components/wiki/wiki-anchors-dialog";
import { WikiAttachmentsView } from "@/app/components/wiki/wiki-attachments-view";
import { WikiBacklinksView } from "@/app/components/wiki/wiki-backlinks-view";
import { WikiCommentsPanel } from "@/app/components/wiki/wiki-comments-panel";
import { WikiHistoryDialog } from "@/app/components/wiki/wiki-history-dialog";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { WikiMoveDialog } from "@/app/components/wiki/wiki-move-dialog";
import { WikiNewPageButton } from "@/app/components/wiki/wiki-new-page-dialog";
import {
  WikiCurrentUntilDialog,
  WikiDeleteDialog,
  WikiDuplicateDialog,
  WikiOwnerDialog,
} from "@/app/components/wiki/wiki-page-dialogs";
import { WikiPageEditor } from "@/app/components/wiki/wiki-page-editor";
import {
  WikiBreadcrumb,
  WikiPageProperties,
} from "@/app/components/wiki/wiki-page-header";
import { WikiPageHero } from "@/app/components/wiki/wiki-page-hero";
import { WikiPageMenu } from "@/app/components/wiki/wiki-page-menu";
import { cn } from "@/app/lib/cn";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiAttachmentEntry } from "@/app/components/wiki/wiki-attachments-view";
import type { QuoteReference } from "@/app/lib/wiki-highlight";
import type { WikiVersionEntry } from "@/app/components/wiki/wiki-history-dialog";
import type { WikiPageDialog } from "@/app/components/wiki/wiki-page-menu";
import type { WikiTemplateChoice } from "@/app/components/wiki/wiki-new-page-form";
import type {
  WikiAnchorChoices,
  WikiBacklinks,
  WikiCommentThread,
  WikiNavigation,
  WikiOwnerCandidate,
  WikiPage,
  WikiPageView,
} from "@/definition/Wiki";

/** Remembers for the browser session whether the comment column is open. */
const COMMENTS_OPEN_KEY = "pages-wiki-comments-open";
/** From this width (Tailwind `xl`) the comments stand beside the text. */
const COMMENTS_BESIDE_QUERY = "(min-width: 80rem)";
const COMMENTS_PANEL_ID = "wiki-comments";
/** A link to a comment ends with `#comment-<id>`. */
const COMMENT_HASH_PREFIX = "#comment-";

interface WikiPageScreenProps {
  readonly view: WikiPageView;
  readonly navigation: WikiNavigation;
  readonly templates: readonly WikiTemplateChoice[];
  readonly versions: readonly WikiVersionEntry[];
  readonly owners: readonly WikiOwnerCandidate[];
  readonly anchorChoices: WikiAnchorChoices;
  readonly backlinks: WikiBacklinks;
  readonly attachments: readonly WikiAttachmentEntry[];
  readonly comments: readonly WikiCommentThread[];
  readonly today: string;
}

function PageDialogs({
  dialog,
  screen,
  onClose,
}: {
  readonly dialog: WikiPageDialog | null;
  readonly screen: WikiPageScreenProps;
  readonly onClose: () => void;
}): React.ReactElement | null {
  const { page, permissions } = screen.view;

  switch (dialog) {
    case "anchors":
      return (
        <WikiAnchorsDialog
          choices={screen.anchorChoices}
          page={page}
          onClose={onClose}
        />
      );
    case "currentUntil":
      return <WikiCurrentUntilDialog page={page} onClose={onClose} />;
    case "delete":
      return (
        <WikiDeleteDialog
          nodes={screen.navigation.nodes}
          page={page}
          onClose={onClose}
        />
      );
    case "duplicate":
      return <WikiDuplicateDialog page={page} onClose={onClose} />;
    case "template":
      return <WikiDuplicateDialog asTemplate page={page} onClose={onClose} />;
    case "history":
      return (
        <WikiHistoryDialog
          canRestore={permissions.canEdit}
          page={page}
          versions={screen.versions}
          onClose={onClose}
        />
      );
    case "move":
      return (
        <WikiMoveDialog
          navigation={screen.navigation}
          request={{
            beforeId: null,
            from: { projectId: page.projectId, scope: page.scope },
            pageId: page.id,
            parentId: page.parentId,
            projectId: page.projectId,
            scope: page.scope,
          }}
          onClose={onClose}
        />
      );
    case "owner":
      return (
        <WikiOwnerDialog owners={screen.owners} page={page} onClose={onClose} />
      );
    case null:
      return null;
  }
}

function ChildrenSection({
  screen,
}: {
  readonly screen: WikiPageScreenProps;
}): React.ReactElement {
  const { t } = useTranslation();
  const { page, permissions, children } = screen.view;

  return (
    <section aria-label={t("wiki.page.children")} className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase">
          {t("wiki.page.children")}
        </h2>
        {permissions.canEdit ? (
          <WikiNewPageButton
            label={t("wiki.page.newSubpage")}
            parentId={page.id}
            projects={screen.navigation.projects}
            templates={screen.templates}
            variant="outline"
          />
        ) : null}
      </div>
      {children.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("wiki.page.noChildren")}
        </p>
      ) : (
        <ul className="space-y-1">
          {children.map((child) => (
            <li key={child.id}>
              <Link
                className="text-sm text-primary hover:underline"
                to={wikiPagePath(child.id, child.title)}
              >
                {child.icon ? `${child.icon} ` : ""}
                {child.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The passages the open comments refer to, to mark them in the text. */
function quotesOf(
  threads: readonly WikiCommentThread[],
): readonly QuoteReference[] {
  return threads.flatMap(({ comment }) =>
    comment.quote === null
      ? []
      : [
          {
            prefix: comment.quotePrefix,
            quote: comment.quote,
            suffix: comment.quoteSuffix,
          },
        ],
  );
}

/** Below the text: "Mentioned in", attachments and subpages. */
function PageFooter({
  screen,
}: {
  readonly screen: WikiPageScreenProps;
}): React.ReactElement {
  const { page, permissions } = screen.view;

  return (
    <div className="mx-auto w-full max-w-[46rem] space-y-6">
      <WikiBacklinksView backlinks={screen.backlinks} />
      <WikiAttachmentsView
        attachments={screen.attachments}
        canUpload={permissions.canEdit}
        pageId={page.id}
      />
      <ChildrenSection screen={screen} />
    </div>
  );
}

/**
 * Picks the newer of the loaded page and the one the editor saved last: the
 * loader does not run again while the editor autosaves.
 */
function newestPage(loaded: WikiPage, saved: WikiPage | null): WikiPage {
  return saved?.id === loaded.id && saved.revision > loaded.revision
    ? saved
    : loaded;
}

/** The text of a page for people who may only read it. */
function WikiPageReading({
  page,
  meta,
  onTextElement,
}: {
  readonly page: WikiPage;
  readonly meta: React.ReactNode;
  readonly onTextElement: (element: HTMLElement | null) => void;
}): React.ReactElement {
  return (
    <div>
      <WikiPageHero page={page} />
      <div className="mx-auto w-full max-w-[46rem] space-y-4">
        {meta}
        <div ref={onTextElement}>
          <WikiMarkdown
            className="text-base"
            hasTicketPills
            source={page.content}
          />
        </div>
      </div>
    </div>
  );
}

interface CommentsColumn {
  readonly isOpen: boolean;
  /** The comment a link points to, if any. */
  readonly targetCommentId: string | null;
  /** Grows whenever the box for a new comment should get the focus. */
  readonly focusRequest: number;
  readonly open: () => void;
  /** Toggles the column beside the text, or jumps to the comments below it. */
  readonly toggle: () => void;
  readonly write: () => void;
}

function readStoredOpen(): boolean {
  try {
    return window.sessionStorage.getItem(COMMENTS_OPEN_KEY) === "1";
  } catch {
    // Private browsing can deny storage; the column then starts closed.
    return false;
  }
}

function storeOpen(isOpen: boolean): void {
  try {
    window.sessionStorage.setItem(COMMENTS_OPEN_KEY, isOpen ? "1" : "0");
  } catch {
    // Without storage the column keeps its state only on this page.
  }
}

/**
 * The comment column: closed by default, opened by the button, a comment on
 * a selection, a link to a comment or "write comment", and remembered for
 * the browser session.
 */
function useCommentsColumn(): CommentsColumn {
  const { hash } = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const targetCommentId = hash.startsWith(COMMENT_HASH_PREFIX)
    ? decodeURIComponent(hash.slice(COMMENT_HASH_PREFIX.length))
    : null;

  function setOpen(next: boolean): void {
    setIsOpen(next);
    storeOpen(next);
  }

  // The server does not know the session, so the stored state applies after hydration.
  useEffect(() => {
    if (readStoredOpen()) {
      setIsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (targetCommentId !== null) {
      setIsOpen(true);
      storeOpen(true);
    }
  }, [targetCommentId]);

  return {
    focusRequest,
    isOpen,
    open: () => setOpen(true),
    targetCommentId,
    toggle: () => {
      if (window.matchMedia(COMMENTS_BESIDE_QUERY).matches) {
        setOpen(!isOpen);

        return;
      }

      document
        .getElementById(COMMENTS_PANEL_ID)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    write: () => {
      setOpen(true);
      setFocusRequest((request) => request + 1);
    },
  };
}

/**
 * The comment buttons of the top bar: "Comment selection" while a passage is
 * selected and the column does not show its own, and "Comments" with the
 * number of open comments.
 */
function CommentButtons({
  column,
  openCount,
  hasSelection,
  onCommentSelection,
}: {
  readonly column: CommentsColumn;
  readonly openCount: number;
  readonly hasSelection: boolean;
  readonly onCommentSelection: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      {hasSelection ? (
        <button
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted",
            column.isOpen && "xl:hidden",
          )}
          type="button"
          // Keep the selection while the button is pressed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCommentSelection}
        >
          <MessageSquareQuote aria-hidden="true" className="size-3.5" />
          {t("wiki.comments.commentSelection")}
        </button>
      ) : null}
      <button
        aria-controls={COMMENTS_PANEL_ID}
        aria-expanded={column.isOpen}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted",
          column.isOpen && "xl:bg-muted",
        )}
        type="button"
        onClick={column.toggle}
      >
        {t("wiki.comments.title")}
        {openCount > 0 ? (
          <span className="text-muted-foreground tabular-nums">
            {openCount}
          </span>
        ) : null}
      </button>
    </>
  );
}

/**
 * The top bar of a page, 56 px high: the breadcrumb on the left; on the
 * right the save state (filled in by the editor), favorite, the comment
 * buttons and the page menu.
 */
function PageTopBar({
  view,
  onOpen,
  onStatusSlot,
  onWriteComment,
  children,
}: {
  readonly view: WikiPageView;
  readonly onOpen: (dialog: WikiPageDialog) => void;
  readonly onStatusSlot: (element: HTMLElement | null) => void;
  readonly onWriteComment: () => void;
  /** The comment buttons. */
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { page } = view;

  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <WikiBreadcrumb page={page} />
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <div ref={onStatusSlot} className="empty:hidden" />
        <WikiPageMenu
          commentsButton={children}
          isFavorite={view.isFavorite}
          isPrivate={page.scope === "private"}
          pageId={page.id}
          permissions={view.permissions}
          onOpen={onOpen}
          onWriteComment={onWriteComment}
        />
      </div>
    </div>
  );
}

/**
 * One wiki page as in Notion: a top bar with breadcrumb, save state,
 * favorite, comments and menu; cover, emoji, title and properties; then the
 * text, edited in place by everybody who may edit, followed by "Mentioned
 * in", attachments and subpages. The comments open in a column at the side.
 */
export function WikiPageScreen(
  loadedScreen: WikiPageScreenProps,
): React.ReactElement {
  const [savedPage, setSavedPage] = useState<WikiPage | null>(null);
  const page = newestPage(loadedScreen.view.page, savedPage);
  const screen = { ...loadedScreen, view: { ...loadedScreen.view, page } };
  const { permissions } = screen.view;
  const [dialog, setDialog] = useState<WikiPageDialog | null>(null);
  const [text, setText] = useState<HTMLElement | null>(null);
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  const selection = useWikiSelection(text);
  const comments = useCommentsColumn();
  const [textVersion, setTextVersion] = useState(0);
  const [requestedQuote, setRequestedQuote] = useState<{
    readonly quote: QuoteReference;
  } | null>(null);
  const openThreads = screen.comments.filter(
    ({ comment }) => comment.resolvedAt === null,
  );
  const quotes = quotesOf(openThreads);
  const meta = <WikiPageProperties page={page} today={screen.today} />;

  useCommentHighlights(text, quotes, textVersion);

  function handleComment(): void {
    if (selection) {
      comments.open();
      setRequestedQuote({ quote: selection });
    }
  }

  return (
    <div
      className={cn(
        "grid gap-8",
        comments.isOpen && "xl:grid-cols-[minmax(0,1fr)_20rem]",
      )}
    >
      <article className="min-w-0">
        <PageTopBar
          view={screen.view}
          onOpen={setDialog}
          onStatusSlot={setStatusSlot}
          onWriteComment={comments.write}
        >
          <CommentButtons
            column={comments}
            hasSelection={selection !== null}
            openCount={openThreads.length}
            onCommentSelection={handleComment}
          />
        </PageTopBar>
        <div className="space-y-6">
          {permissions.canEdit ? (
            <WikiPageEditor
              key={page.id}
              attachments={screen.attachments}
              meta={meta}
              page={page}
              statusSlot={statusSlot}
              onComment={handleComment}
              onSaved={setSavedPage}
              onTextChange={() => setTextVersion((version) => version + 1)}
              onTextElement={setText}
            />
          ) : (
            <WikiPageReading
              key={page.id}
              meta={meta}
              page={page}
              onTextElement={setText}
            />
          )}
          <PageFooter screen={screen} />
        </div>
        <PageDialogs
          dialog={dialog}
          screen={screen}
          onClose={() => setDialog(null)}
        />
      </article>
      <WikiCommentsPanel
        focusRequest={comments.focusRequest}
        id={COMMENTS_PANEL_ID}
        isOpen={comments.isOpen}
        pageId={page.id}
        requestedQuote={requestedQuote}
        selection={selection}
        targetCommentId={comments.targetCommentId}
        threads={screen.comments}
      />
    </div>
  );
}
