import { useTranslation } from "react-i18next";

import { EditorBlockHandle } from "@/app/components/editor/editor-block-handle";
import { EditorContextMenu } from "@/app/components/editor/editor-context-menu";
import { caretRect } from "@/app/components/editor/editor-geometry";
import { EditorLinkDialog } from "@/app/components/editor/editor-link-dialog";
import { EditorMobileToolbar } from "@/app/components/editor/editor-mobile-toolbar";
import { EditorSelectionToolbar } from "@/app/components/editor/editor-selection-toolbar";
import { insertUploads } from "@/app/components/editor/editor-uploads";
import { EmojiPicker } from "@/app/components/editor/emoji-picker";
import { EditorTypingMenus } from "@/app/components/editor/menus/editor-typing-menus";
import { FloatingPanel } from "@/app/components/editor/menus/floating-panel";
import { useEditorNotice } from "@/app/components/editor/use-editor-notice";
import { cn } from "@/app/lib/cn";

import type { Editor } from "@tiptap/core";
import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";
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
  readonly fileInput: React.RefObject<HTMLInputElement | null>;
  readonly openAtCaret: (editor: Editor, showAssistant: boolean) => void;
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
        features={features}
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
  const { t } = useTranslation();
  const notice = useEditorNotice();
  const { menu, emojiAnchor, setEmojiAnchor, setIsLinkOpen } = overlays;
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
          onMenu={() => overlays.openAtCaret(editor, false)}
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
