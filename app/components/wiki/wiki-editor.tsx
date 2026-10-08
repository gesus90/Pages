import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { useWikiDraft } from "@/app/components/wiki/use-wiki-draft";
import { useWikiEditorText } from "@/app/components/wiki/use-wiki-editor-text";
import { useWikiUploads } from "@/app/components/wiki/use-wiki-uploads";
import { WikiConflictDialog } from "@/app/components/wiki/wiki-conflict-dialog";
import { WikiEditorMenu } from "@/app/components/wiki/wiki-editor-menu";
import { WikiEditorToolbar } from "@/app/components/wiki/wiki-editor-toolbar";
import {
  AttachmentButton,
  UploadStatus,
} from "@/app/components/wiki/wiki-editor-uploads";
import { WikiIconPicker } from "@/app/components/wiki/wiki-icon-picker";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";
import { countCharacters, WIKI_LIMITS } from "@/definition/Wiki";

import type {
  WikiDraft,
  WikiDraftState,
} from "@/app/components/wiki/use-wiki-draft";
import type { WikiEditorTextState } from "@/app/components/wiki/use-wiki-editor-text";
import type { WikiPage } from "@/definition/Wiki";

interface WikiEditorProps {
  readonly page: WikiPage;
  /** Called once everything is saved and the person is done, with the saved page. */
  readonly onDone: (saved: WikiPage) => void;
}

function Counter({
  length,
  limit,
}: {
  readonly length: number;
  readonly limit: number;
}): React.ReactElement | null {
  return length >= limit * 0.8 ? (
    <span
      className={cn(
        "text-xs",
        length > limit ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {length} / {limit}
    </span>
  ) : null;
}

function EditorHeader({
  draft,
  onChange,
}: {
  readonly draft: WikiDraft;
  readonly onChange: (draft: WikiDraft) => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-center gap-3">
        <WikiIconPicker
          value={draft.icon}
          onChange={(icon) => onChange({ ...draft, icon })}
        />
        <Input
          aria-label={t("wiki.editor.titleLabel")}
          className="h-12 flex-1 text-2xl font-semibold"
          value={draft.title}
          onChange={(event) =>
            onChange({ ...draft, title: event.target.value })
          }
        />
      </div>
      <div className="flex justify-end">
        <Counter
          length={countCharacters(draft.title)}
          limit={WIKI_LIMITS.titleLength}
        />
      </div>
    </>
  );
}

function EditorPanes({
  content,
  text,
  view,
  onFiles,
}: {
  readonly content: string;
  readonly text: WikiEditorTextState;
  readonly view: "write" | "preview";
  readonly onFiles: (files: readonly File[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className={cn("relative", view === "preview" && "hidden md:block")}>
        <Textarea
          ref={text.textareaRef}
          aria-label={t("wiki.editor.contentLabel")}
          className="min-h-[28rem] font-mono text-sm"
          value={content}
          onChange={text.handleChange}
          onClick={text.handleCaretMove}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onFiles([...event.dataTransfer.files]);
          }}
          onKeyDown={text.handleKeyDown}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];

            if (files.length > 0) {
              event.preventDefault();
              onFiles(files);
            }
          }}
          onKeyUp={(event) =>
            event.key.startsWith("Arrow") ? text.handleCaretMove() : undefined
          }
        />
        {text.menu ? (
          <WikiEditorMenu
            activeIndex={text.menuIndex}
            emptyLabel={t("wiki.editor.noMatch")}
            items={text.menu.items}
            label={t(`wiki.editor.menu.${text.menu.kind}`)}
            onPick={text.pickItem}
          />
        ) : null}
      </div>
      <div
        aria-label={t("wiki.editor.preview")}
        className={cn(
          "min-h-[28rem] rounded-xl border border-border p-4",
          view === "write" && "hidden md:block",
        )}
      >
        <WikiMarkdown source={content} />
      </div>
    </div>
  );
}

function EditorFooter({
  content,
  errorCode,
  isFinishing,
  status,
  onFinish,
}: {
  readonly content: string;
  readonly errorCode: WikiDraftState["errorCode"];
  readonly isFinishing: boolean;
  readonly status: WikiDraftState["status"];
  readonly onFinish: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p
        aria-live="polite"
        className="text-sm text-muted-foreground"
        role="status"
      >
        {t(`wiki.editor.status.${status}`)}
        {errorCode ? ` – ${t(`wiki.errors.${errorCode}`)}` : ""}
      </p>
      <div className="flex items-center gap-3">
        <Counter
          length={countCharacters(content)}
          limit={WIKI_LIMITS.contentLength}
        />
        <Button
          isPending={isFinishing && status !== "saved"}
          onClick={onFinish}
        >
          {t("wiki.editor.done")}
        </Button>
      </div>
    </div>
  );
}

/** The editor of a page: title, formatting, text and a live preview. */
export function WikiEditor({
  page,
  onDone,
}: WikiEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const state = useWikiDraft(page);
  const { draft, setDraft } = state;
  const text = useWikiEditorText(draft.content, (content) =>
    setDraft({ ...draft, content }),
  );
  const uploads = useWikiUploads(page.id, text.insertText);
  const [view, setView] = useState<"write" | "preview">("write");
  const [isFinishing, setIsFinishing] = useState(false);
  const isSaved = state.status === "saved";

  const { saved } = state;

  useEffect(() => {
    if (isFinishing && isSaved) {
      onDone(saved);
    }
  }, [isFinishing, isSaved, onDone, saved]);

  useEffect(() => {
    if (state.isClean) {
      return undefined;
    }

    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();

    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [state.isClean]);

  return (
    <div className="space-y-3">
      <EditorHeader draft={draft} onChange={setDraft} />
      <WikiEditorToolbar onCommand={text.runCommand}>
        <AttachmentButton onFiles={(files) => void uploads.upload(files)} />
      </WikiEditorToolbar>
      <UploadStatus uploads={uploads} />
      <div className="flex gap-2 md:hidden">
        {(["write", "preview"] as const).map((mode) => (
          <Button
            key={mode}
            aria-pressed={view === mode}
            size="sm"
            variant={view === mode ? "default" : "outline"}
            onClick={() => setView(mode)}
          >
            {t(`wiki.editor.${mode}`)}
          </Button>
        ))}
      </div>
      <EditorPanes
        content={draft.content}
        text={text}
        view={view}
        onFiles={(files) => void uploads.upload(files)}
      />
      <EditorFooter
        content={draft.content}
        errorCode={state.errorCode}
        isFinishing={isFinishing}
        status={state.status}
        onFinish={() => {
          state.saveNow();
          setIsFinishing(true);
        }}
      />
      {state.conflict ? (
        <WikiConflictDialog
          mine={draft.content}
          theirs={state.conflict.theirs.content}
          onKeepMine={state.conflict.keepMine}
          onTakeTheirs={state.conflict.takeTheirs}
        />
      ) : null}
    </div>
  );
}
