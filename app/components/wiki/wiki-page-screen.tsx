import { useCallback, useRef, useState } from "react";
import { AssistantPanel } from "@/app/components/assistant/assistant-panel";
import { useTextAssistant } from "@/app/components/assistant/use-text-assistant";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

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
  WikiPageMeta,
} from "@/app/components/wiki/wiki-page-header";
import { WikiPageHero } from "@/app/components/wiki/wiki-page-hero";
import { WikiPageMenu } from "@/app/components/wiki/wiki-page-menu";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiAttachmentEntry } from "@/app/components/wiki/wiki-attachments-view";
import type { BlockEditorHandle } from "@/app/components/editor/block-editor-types";
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
  const handle = useRef<BlockEditorHandle | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const assistant = useTextAssistant({
    context: { kind: "wiki", id: page.id, version: String(page.revision) },
    title: page.title,
    handle,
    content: page.content,
    canEdit: false,
    canSend: true,
    maximumLength: 200_000,
    selectionElement: element,
  });
  const reportElement = useCallback(
    (node: HTMLElement | null): void => {
      setElement(node);
      onTextElement(node);
    },
    [onTextElement],
  );
  return (
    <div className="space-y-4">
      <WikiPageHero page={page} />
      <div className="mx-auto w-full max-w-[46rem] space-y-4">
        {meta}
        <div ref={reportElement}>
          <WikiMarkdown className="text-base" source={page.content} />
        </div>
      </div>
      <AssistantPanel {...assistant.panel} />
    </div>
  );
}

/**
 * One wiki page as in Notion: breadcrumb and menu on top, cover, emoji and
 * title, then the text, edited in place by everybody who may edit, followed
 * by attachments and subpages, with the comments at the side.
 */
export function WikiPageScreen(
  loadedScreen: WikiPageScreenProps,
): React.ReactElement {
  const [savedPage, setSavedPage] = useState<WikiPage | null>(null);
  const page = newestPage(loadedScreen.view.page, savedPage);
  const screen = { ...loadedScreen, view: { ...loadedScreen.view, page } };
  const { permissions, isFavorite } = screen.view;
  const [dialog, setDialog] = useState<WikiPageDialog | null>(null);
  const [text, setText] = useState<HTMLElement | null>(null);
  const selection = useWikiSelection(text);
  const [textVersion, setTextVersion] = useState(0);
  const [requestedQuote, setRequestedQuote] = useState<{
    readonly quote: QuoteReference;
  } | null>(null);
  const quotes = screen.comments.flatMap(({ comment }) =>
    comment.quote !== null && comment.resolvedAt === null
      ? [
          {
            prefix: comment.quotePrefix,
            quote: comment.quote,
            suffix: comment.quoteSuffix,
          },
        ]
      : [],
  );
  const meta = (
    <>
      <WikiPageMeta page={page} today={screen.today} />
      <WikiBacklinksView backlinks={screen.backlinks} />
    </>
  );

  useCommentHighlights(text, quotes, textVersion);

  function handleComment(): void {
    if (selection) {
      setRequestedQuote({ quote: selection });
    }
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <article className="min-w-0 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <WikiBreadcrumb page={page} />
          <WikiPageMenu
            isFavorite={isFavorite}
            isPrivate={page.scope === "private"}
            pageId={page.id}
            permissions={permissions}
            onOpen={setDialog}
          />
        </div>
        {permissions.canEdit ? (
          <WikiPageEditor
            key={page.id}
            attachments={screen.attachments}
            meta={meta}
            page={page}
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
        <div className="mx-auto w-full max-w-[46rem] space-y-6">
          <WikiAttachmentsView
            attachments={screen.attachments}
            canUpload={permissions.canEdit}
            pageId={page.id}
          />
          <ChildrenSection screen={screen} />
        </div>
        <PageDialogs
          dialog={dialog}
          screen={screen}
          onClose={() => setDialog(null)}
        />
      </article>
      <WikiCommentsPanel
        pageId={page.id}
        requestedQuote={requestedQuote}
        selection={selection}
        threads={screen.comments}
      />
    </div>
  );
}
