import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { EditorBlockHandle } from "@/app/components/editor/editor-block-handle";
import { EditorContextMenu } from "@/app/components/editor/editor-context-menu";
import { caretRect } from "@/app/components/editor/editor-geometry";
import { EditorLinkDialog } from "@/app/components/editor/editor-link-dialog";
import { insertTicketBlock } from "@/app/components/editor/editor-menu-extensions";
import { EditorMobileToolbar } from "@/app/components/editor/editor-mobile-toolbar";
import { EditorSelectionToolbar } from "@/app/components/editor/editor-selection-toolbar";
import { insertUploads } from "@/app/components/editor/editor-uploads";
import { EmojiPicker } from "@/app/components/editor/emoji-picker";
import { EditorTypingMenus } from "@/app/components/editor/menus/editor-typing-menus";
import { FloatingPanel } from "@/app/components/editor/menus/floating-panel";
import { useEditorNotice } from "@/app/components/editor/use-editor-notice";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";

import type { Editor } from "@tiptap/core";
import type {
  BlockEditorFeatures,
  EditorReference,
} from "@/app/components/editor/block-editor-types";
import type { ContextMenuRequest } from "@/app/components/editor/editor-context-menu";
import type { EditorMenuStores } from "@/app/components/editor/editor-menu-extensions";

/** The open menus, dialogs and pickers of one editor. */
export interface EditorOverlayState {
  readonly menu: {
    readonly key: number;
    readonly request: ContextMenuRequest;
  } | null;
  readonly setMenu: (menu: null) => void;
  readonly openMenu: (request: ContextMenuRequest) => void;
  readonly isLinkOpen: boolean;
  readonly setIsLinkOpen: (isOpen: boolean) => void;
  readonly emojiAnchor: DOMRect | null;
  readonly setEmojiAnchor: (anchor: DOMRect | null) => void;
  /** Where the ticket picker of `/ticket` is open; `null` when closed. */
  readonly ticketAnchor: DOMRect | null;
  readonly setTicketAnchor: (anchor: DOMRect | null) => void;
  readonly fileInput: React.RefObject<HTMLInputElement | null>;
  readonly openAtCaret: (editor: Editor) => void;
}

interface EditorOverlaysProps {
  readonly editor: Editor;
  readonly container: HTMLElement | null;
  readonly features: BlockEditorFeatures;
  readonly stores: EditorMenuStores;
  readonly overlays: EditorOverlayState;
  readonly isEditable: boolean;
  readonly isApple: boolean;
  readonly id: string;
}

/** The tools that only make sense while the text can be edited. */
function EditingTools({
  editor,
  container,
  features,
  stores,
  isApple,
  id,
  onEmoji,
  onLink,
  onMenu,
  onNotice,
}: Omit<EditorOverlaysProps, "overlays" | "isEditable"> & {
  readonly onEmoji: () => void;
  readonly onLink: () => void;
  readonly onMenu: () => void;
  readonly onNotice: (message: string) => void;
}): React.ReactElement {
  return (
    <>
      <EditorBlockHandle
        container={container}
        editor={editor}
        features={features}
        isApple={isApple}
        onNotice={onNotice}
      />
      <EditorSelectionToolbar
        editor={editor}
        features={features}
        isApple={isApple}
        onLink={onLink}
      />
      <EditorTypingMenus
        editor={editor}
        id={id}
        isApple={isApple}
        stores={stores}
      />
      <EditorMobileToolbar
        editor={editor}
        isApple={isApple}
        onEmoji={onEmoji}
        onLink={onLink}
        onMenu={onMenu}
      />
    </>
  );
}

/** Time typing in the ticket picker rests before it asks the server. */
const TICKET_SEARCH_DELAY_MS = 150;
const TICKET_ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowDown: 1,
  ArrowUp: -1,
};

/** The tickets the person may see that match the query of the picker. */
function useTicketResults(
  features: BlockEditorFeatures,
  query: string,
): {
  readonly results: readonly EditorReference[];
  readonly isLoaded: boolean;
} {
  const find = useRef(features.findReferences);
  const [answer, setAnswer] = useState<{
    readonly results: readonly EditorReference[];
    readonly isLoaded: boolean;
  }>({ isLoaded: false, results: [] });

  useEffect(() => {
    find.current = features.findReferences;
  });

  useEffect(() => {
    let isCurrent = true;
    const timer = setTimeout(() => {
      void (async () => {
        const found = (await find.current?.(query)) ?? [];

        if (isCurrent) {
          setAnswer({
            isLoaded: true,
            results: found.filter((reference) => reference.kind === "ticket"),
          });
        }
      })();
    }, TICKET_SEARCH_DELAY_MS);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [query]);

  return answer;
}

/**
 * Asks for a ticket the person may see, as `@` does, for the ticket block of
 * `/ticket`. Arrow keys choose, Enter takes the chosen ticket.
 */
function TicketPicker({
  features,
  onPick,
}: {
  readonly features: BlockEditorFeatures;
  readonly onPick: (reference: EditorReference) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { results, isLoaded } = useTicketResults(features, query);
  const active: EditorReference | undefined =
    results[Math.min(activeIndex, results.length - 1)];

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    const step = TICKET_ARROW_STEPS[event.key];

    if (step !== undefined && results.length > 0) {
      event.preventDefault();
      setActiveIndex(
        (current) => (current + step + results.length) % results.length,
      );
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      onPick(active);
    }
  }

  return (
    <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      <Input
        aria-label={t("editor.ticket.search")}
        autoFocus
        placeholder={t("editor.ticket.search")}
        size="sm"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      <ul
        aria-label={t("editor.ticket.results")}
        className="max-h-64 overflow-y-auto"
        role="listbox"
      >
        {results.map((reference) => (
          <li
            key={reference.key}
            aria-selected={reference === active}
            role="option"
          >
            <button
              className={cn(
                "w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted",
                reference === active && "bg-muted",
              )}
              type="button"
              onClick={() => onPick(reference)}
            >
              {reference.label}
            </button>
          </li>
        ))}
      </ul>
      {isLoaded && results.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted-foreground" role="status">
          {t("editor.ticket.empty")}
        </p>
      ) : null}
    </div>
  );
}

/** The emoji picker and the ticket picker of `/ticket`, at the caret. */
function PickerPanels({
  editor,
  features,
  overlays,
}: Pick<
  EditorOverlaysProps,
  "editor" | "features" | "overlays"
>): React.ReactElement {
  const { t } = useTranslation();
  const { emojiAnchor, setEmojiAnchor, ticketAnchor, setTicketAnchor } =
    overlays;

  return (
    <>
      <FloatingPanel
        anchor={emojiAnchor}
        label={t("editor.menu.emoji")}
        onClose={() => setEmojiAnchor(null)}
      >
        <EmojiPicker
          onPick={(emoji) => {
            setEmojiAnchor(null);
            editor.chain().focus().insertContent(emoji).run();
          }}
        />
      </FloatingPanel>
      <FloatingPanel
        anchor={ticketAnchor}
        label={t("editor.ticket.label")}
        onClose={() => {
          setTicketAnchor(null);
          editor.commands.focus();
        }}
      >
        <TicketPicker
          features={features}
          onPick={(reference) => {
            setTicketAnchor(null);
            insertTicketBlock(editor, reference);
          }}
        />
      </FloatingPanel>
    </>
  );
}

/**
 * Everything the editor shows on top of the text: handle, toolbars, menus,
 * the link dialog, the emoji picker, the file chooser and its notices.
 */
export function EditorOverlays({
  editor,
  container,
  features,
  stores,
  overlays,
  isEditable,
  isApple,
  id,
}: EditorOverlaysProps): React.ReactElement {
  const notice = useEditorNotice();
  const { menu, setEmojiAnchor, setIsLinkOpen } = overlays;
  const openEmoji = (): void => setEmojiAnchor(caretRect(editor));
  const openLink = (): void => setIsLinkOpen(true);

  async function handleFiles(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const files = [...(event.target.files ?? [])];

    event.target.value = "";

    if (features.uploadFiles && files.length > 0) {
      await insertUploads(editor.view, files, features.uploadFiles);
    }
  }

  return (
    <>
      {isEditable ? (
        <EditingTools
          container={container}
          editor={editor}
          features={features}
          id={id}
          isApple={isApple}
          stores={stores}
          onEmoji={openEmoji}
          onLink={openLink}
          onMenu={() => overlays.openAtCaret(editor)}
          onNotice={notice.show}
        />
      ) : null}
      {menu ? (
        <EditorContextMenu
          key={menu.key}
          editor={editor}
          features={features}
          isApple={isApple}
          request={menu.request}
          onClose={() => overlays.setMenu(null)}
          onEmoji={openEmoji}
          onLink={openLink}
          onNotice={notice.show}
        />
      ) : null}
      {overlays.isLinkOpen ? (
        <EditorLinkDialog
          editor={editor}
          onClose={() => setIsLinkOpen(false)}
        />
      ) : null}
      <PickerPanels editor={editor} features={features} overlays={overlays} />
      <input
        ref={overlays.fileInput}
        hidden
        multiple
        type="file"
        onChange={(event) => void handleFiles(event)}
      />
      <p
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-foreground px-4 py-2 text-sm text-surface shadow-panel",
          notice.message === null && "sr-only",
        )}
        role="status"
      >
        {notice.message}
      </p>
    </>
  );
}
