import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRevalidator } from "react-router";

import { BlockEditor } from "@/app/components/editor/block-editor";
import { AssistantPanel } from "@/app/components/assistant/assistant-panel";
import { useWikiTextAssistant } from "./use-wiki-text-assistant";
import { useSaveBeforeLeave } from "@/app/components/wiki/use-save-before-leave";
import { useWikiDraft } from "@/app/components/wiki/use-wiki-draft";
import { useWikiEditorFeatures } from "@/app/components/wiki/use-wiki-editor-features";
import { useWikiUploads } from "@/app/components/wiki/use-wiki-uploads";
import { WikiConflictDialog } from "@/app/components/wiki/wiki-conflict-dialog";
import { WikiCoverDialog } from "@/app/components/wiki/wiki-cover-dialog";
import { UploadStatus } from "@/app/components/wiki/wiki-editor-uploads";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { WikiPageHero } from "@/app/components/wiki/wiki-page-hero";
import { WikiSubpageDialog } from "@/app/components/wiki/wiki-subpage-dialog";
import { cn } from "@/app/lib/cn";
import { countCharacters, WIKI_LIMITS } from "@/definition/Wiki";

import type {
  BlockEditorHandle,
  EditorPageLink,
} from "@/app/components/editor/block-editor-types";
import type { WikiDraftState } from "@/app/components/wiki/use-wiki-draft";
import type { WikiAttachment, WikiPage } from "@/definition/Wiki";

interface WikiPageEditorProps {
  /** The newest known state of the page. */
  readonly page: WikiPage;
  readonly attachments: readonly WikiAttachment[];
  /** Meta line and marks, shown between title and text. */
  readonly meta: React.ReactNode;
  /** Receives the element of the editable text, for inline comments. */
  readonly onTextElement: (element: HTMLElement | null) => void;
  /** Receives every change of the text, to refresh comment marks. */
  readonly onTextChange: () => void;
  readonly onComment: () => void;
  /** Receives the page whenever a save went through. */
  readonly onSaved: (page: WikiPage) => void;
}

/** Shows how saving goes, without a visible form frame (T4.3.6). */
function SaveStatus({
  state,
}: {
  readonly state: WikiDraftState;
}): React.ReactElement {
  const { t } = useTranslation();
  const length = countCharacters(state.draft.content);

  return (
    <p
      aria-live="polite"
      className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
      role="status"
    >
      <span
        className={cn(
          state.status !== "saved" &&
            state.status !== "saving" &&
            state.status !== "unsaved" &&
            "text-destructive",
        )}
      >
        {t(`wiki.editor.status.${state.status}`)}
        {state.errorCode ? ` – ${t(`wiki.errors.${state.errorCode}`)}` : ""}
      </span>
      {length >= WIKI_LIMITS.contentLength * 0.8 ? (
        <span
          className={
            length > WIKI_LIMITS.contentLength ? "text-destructive" : undefined
          }
        >
          {length} / {WIKI_LIMITS.contentLength}
        </span>
      ) : null}
    </p>
  );
}

/** Asks for a subpage through the dialog and resolves with the new page. */
function useSubpageRequest(): {
  readonly isOpen: boolean;
  readonly open: () => Promise<EditorPageLink | null>;
  readonly finish: (link: EditorPageLink | null) => void;
} {
  const resolver = useRef<((link: EditorPageLink | null) => void) | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  return {
    finish: (link) => {
      resolver.current?.(link);
      resolver.current = null;
      setIsOpen(false);
    },
    open: () =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setIsOpen(true);
      }),
    isOpen,
  };
}

/**
 * The page for people who may edit it: cover, emoji and title in place, the
 * block editor below, autosave with revision and conflict dialog, and saving
 * before leaving the page.
 */
export function WikiPageEditor({
  page,
  attachments,
  meta,
  onTextElement,
  onTextChange,
  onComment,
  onSaved,
}: WikiPageEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const state = useWikiDraft(page);
  const { conflict, draft, setDraft } = state;
  const handle = useRef<BlockEditorHandle | null>(null);
  const assistant = useWikiTextAssistant(state, page, handle);
  const navigate = useNavigate();
  const subpage = useSubpageRequest();
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [isChoosingCover, setIsChoosingCover] = useState(false);
  const uploads = useWikiUploads(page.id, () => void revalidator.revalidate());
  const features = useWikiEditorFeatures({
    onComment,
    pageId: page.id,
    requestSubpage: async () => {
      const link = await subpage.open();

      setPendingLink(link?.href ?? null);

      return link;
    },
    uploads,
  });

  useSaveBeforeLeave(state);
  useAdoptNewerVersion(state, page, handle);
  useReportSaved(state.saved, onSaved);

  useEffect(() => {
    if (pendingLink !== null && draft.content.includes(pendingLink)) {
      setPendingLink(null);
      void navigate(pendingLink);
    }
  }, [draft.content, navigate, pendingLink]);

  return (
    <div className="space-y-4">
      <WikiPageHero
        editing={{
          icon: draft.icon,
          onChooseCover: () => setIsChoosingCover(true),
          onIconChange: (icon) => setDraft({ ...draft, icon }),
          onTitleChange: (title) => setDraft({ ...draft, title }),
          onTitleEnter: () => handle.current?.focusStart(),
          title: draft.title,
        }}
        page={page}
      />
      <div className="mx-auto w-full max-w-[46rem] space-y-4">
        {meta}
        <SaveStatus state={state} />
        <UploadStatus uploads={uploads} />
        <BlockEditor
          fallback={
            <WikiMarkdown className="text-base" source={page.content} />
          }
          features={{ ...features, textAssistant: assistant.editorFeature }}
          isEditable
          label={t("wiki.editor.contentLabel")}
          markdown={page.content}
          onChange={(content) => {
            setDraft({ ...draft, content });
            onTextChange();
          }}
          onReady={(ready) => {
            handle.current = ready;
            onTextElement(ready?.element ?? null);
          }}
        />
      </div>
      <AssistantPanel {...assistant.panel} />
      {conflict ? (
        <WikiConflictDialog
          mine={draft.content}
          theirs={conflict.theirs.content}
          onKeepMine={conflict.keepMine}
          onTakeTheirs={() => {
            handle.current?.replaceMarkdown(conflict.theirs.content);
            conflict.takeTheirs();
          }}
        />
      ) : null}
      {subpage.isOpen ? (
        <WikiSubpageDialog parentId={page.id} onDone={subpage.finish} />
      ) : null}
      {isChoosingCover ? (
        <WikiCoverDialog
          attachments={attachments}
          pageId={page.id}
          onClose={() => setIsChoosingCover(false)}
        />
      ) : null}
    </div>
  );
}

/** Loads a newer saved version, such as a restored one, into the editor. */
function useAdoptNewerVersion(
  state: WikiDraftState,
  page: WikiPage,
  handle: React.RefObject<BlockEditorHandle | null>,
): void {
  const { adopt } = state;

  useEffect(() => {
    if (adopt(page)) {
      handle.current?.replaceMarkdown(page.content);
    }
  }, [adopt, handle, page]);
}

/** Reports every successful save to the page screen. */
function useReportSaved(
  saved: WikiPage,
  onSaved: (page: WikiPage) => void,
): void {
  useEffect(() => {
    onSaved(saved);
  }, [onSaved, saved]);
}
