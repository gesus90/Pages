import { EditorContent } from "@tiptap/react";
import { useEffect, useId, useRef, useState } from "react";

import { caretRect } from "@/app/components/editor/editor-geometry";
import { EditorFixedToolbar } from "@/app/components/editor/editor-fixed-toolbar";
import { EditorOverlays } from "@/app/components/editor/editor-overlays";
import { useBlockEditor } from "@/app/components/editor/use-block-editor";
import { cn } from "@/app/lib/cn";
import { isApplePlatform } from "@/app/lib/editor/editor-shortcuts";

import styles from "@/app/components/editor/block-editor.module.css";

import type {
  BlockEditorFeatures,
  BlockEditorHandle,
} from "@/app/components/editor/block-editor-types";
import type { ContextMenuRequest } from "@/app/components/editor/editor-context-menu";
import type { EditorOverlayState } from "@/app/components/editor/editor-overlays";
import type { BlockEditorControls } from "@/app/components/editor/use-block-editor";

interface BlockEditorProps {
  /** Markdown the document starts with. */
  readonly markdown: string;
  readonly isEditable: boolean;
  /** Accessible name of the editable text. */
  readonly label: string;
  readonly features: BlockEditorFeatures;
  readonly onChange?: (markdown: string) => void;
  /** Receives the controls once the editor is mounted, `null` when it goes. */
  readonly onReady?: (handle: BlockEditorHandle | null) => void;
  /** Shown until the editor runs in the browser, such as the rendered page. */
  readonly fallback: React.ReactNode;
  readonly className?: string;
  /**
   * Shows a compact formatting toolbar above the text on larger screens, as
   * Jira does above a description (A8.2).
   */
  readonly hasToolbar?: boolean;
}

function useReadyHandle(
  controls: BlockEditorControls | null,
  onReady: BlockEditorProps["onReady"],
): void {
  useEffect(() => {
    if (!controls || !onReady) {
      return undefined;
    }

    const { editor } = controls;

    onReady({
      element: editor.view.dom,
      focusStart: () => {
        editor.commands.focus("start");
        // Tiptap focuses one frame later; keys typed right away (Enter in
        // the title, then text) must already land in the editor.
        editor.view.focus();
      },
      getMarkdown: controls.getMarkdown,
      replaceMarkdown: controls.replaceMarkdown,
      captureAssistantTarget: controls.captureAssistantTarget,
      applyAssistantText: controls.applyAssistantText,
    });

    return () => onReady(null);
  }, [controls, onReady]);
}

/** Open menus, dialogs and pickers of the editor, as plain state. */
function useOverlayState(): EditorOverlayState {
  const [menu, setMenu] = useState<{
    key: number;
    request: ContextMenuRequest;
  } | null>(null);
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<DOMRect | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function openMenu(request: ContextMenuRequest): void {
    setMenu((current) => ({ key: (current?.key ?? 0) + 1, request }));
  }

  return {
    emojiAnchor,
    fileInput,
    isLinkOpen,
    menu,
    openAtCaret: (editor, showAssistant) => {
      const rect = caretRect(editor);

      openMenu({ showAssistant, x: rect.left, y: rect.bottom });
    },
    openMenu,
    setEmojiAnchor,
    setIsLinkOpen,
    setMenu,
  };
}

/**
 * The block editor of Pages: Notion-like editing of a markdown document with
 * markdown shortcuts, the slash menu, a selection toolbar, block handles,
 * an own context menu (right click, Shift+F10, touch toolbar) and the
 * reference and emoji menus.
 *
 * @remarks
 * The server renders `fallback`; the editor replaces it in the browser. The
 * document stays markdown: `onChange` receives the markdown after every
 * change, unchanged blocks keep their text exactly. Without the right to
 * write, the document can be read, selected and copied, nothing else.
 */
export function BlockEditor({
  markdown,
  isEditable,
  label,
  features,
  onChange,
  onReady,
  fallback,
  className,
  hasToolbar = false,
}: BlockEditorProps): React.ReactElement {
  const id = useId();
  const [isApple] = useState(
    () =>
      typeof navigator !== "undefined" && isApplePlatform(navigator.userAgent),
  );
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const overlays = useOverlayState();
  const { openAtCaret, setEmojiAnchor, setIsLinkOpen, fileInput } = overlays;
  const state = useBlockEditor({
    events: {
      onChange: (next) => onChange?.(next),
      onContextMenu: (current) => openAtCaret(current, false),
      onLink: () => setIsLinkOpen(true),
      onRequestEmoji: (current) => setEmojiAnchor(caretRect(current)),
      onRequestFiles: () => fileInput.current?.click(),
      onTextAssistant: (current) => openAtCaret(current, true),
    },
    features,
    isEditable,
    label,
    markdown,
  });
  const { editor } = state;

  useReadyHandle(state.controls, onReady);

  if (!editor) {
    return <div className={className}>{fallback}</div>;
  }

  return (
    <div
      ref={setContainer}
      className={cn("relative", styles.content, className)}
      onContextMenu={(event) => {
        if (
          event.target instanceof Node &&
          editor.view.dom.contains(event.target)
        ) {
          event.preventDefault();
          overlays.openMenu({ x: event.clientX, y: event.clientY });
        }
      }}
    >
      {hasToolbar && isEditable ? (
        <EditorFixedToolbar
          editor={editor}
          features={features}
          isApple={isApple}
          onEmoji={() => setEmojiAnchor(caretRect(editor))}
          onFiles={() => fileInput.current?.click()}
          onLink={() => setIsLinkOpen(true)}
          onMenu={() => openAtCaret(editor, false)}
        />
      ) : null}
      <EditorContent editor={editor} />
      <EditorOverlays
        container={container}
        editor={editor}
        features={features}
        id={id}
        isApple={isApple}
        isEditable={isEditable}
        overlays={overlays}
        stores={state.stores}
      />
    </div>
  );
}
