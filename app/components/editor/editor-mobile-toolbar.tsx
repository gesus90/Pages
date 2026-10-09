import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Ellipsis,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListChecks,
  Plus,
  Redo2,
  Smile,
  Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  EditorToolbarButton,
  moveToolbarFocus,
} from "@/app/components/editor/editor-toolbar-button";
import { useKeyboardInset } from "@/app/components/editor/use-keyboard-inset";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

import type { Editor } from "@tiptap/core";

interface EditorMobileToolbarProps {
  readonly editor: Editor;
  readonly isApple: boolean;
  readonly onLink: () => void;
  readonly onEmoji: () => void;
  readonly onMenu: () => void;
}

/**
 * Opens the slash menu at the caret: a slash after a blank or at the start
 * of a line opens it, so a blank is added after other text.
 *
 * @param editor - The editor.
 */
export function openSlashMenu(editor: Editor): void {
  const { $from } = editor.state.selection;
  const before = $from.parent.textBetween(
    Math.max(0, $from.parentOffset - 1),
    $from.parentOffset,
  );

  editor
    .chain()
    .focus()
    .insertContent(before === "" || before === " " ? "/" : " /")
    .run();
}

function currentListItem(editor: Editor): string {
  return editor.isActive(EDITOR_NODE.taskItem)
    ? EDITOR_NODE.taskItem
    : EDITOR_NODE.listItem;
}

/**
 * The explicit toolbar for touch devices (Notion shows one instead of hover
 * actions): insert, formatting, lists, indent, undo and the context menu.
 * It shows while the editor has the focus on small screens and stays above
 * the on-screen keyboard.
 */
export function EditorMobileToolbar({
  editor,
  isApple,
  onLink,
  onEmoji,
  onMenu,
}: EditorMobileToolbarProps): React.ReactElement | null {
  const { t } = useTranslation();
  const inset = useKeyboardInset();
  const isFocused = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isFocused,
  });
  const chain = (): ReturnType<Editor["chain"]> => editor.chain().focus();

  if (!isFocused) {
    return null;
  }

  return (
    <div
      aria-label={t("editor.toolbar.mobile")}
      className="pages-thin-scrollbar fixed inset-x-0 z-20 flex gap-0.5 overflow-x-auto border-t border-border bg-surface px-2 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
      role="toolbar"
      style={{ bottom: inset }}
      onKeyDown={moveToolbarFocus}
    >
      <EditorToolbarButton
        icon={Plus}
        isApple={isApple}
        label={t("editor.toolbar.insert")}
        onClick={() => openSlashMenu(editor)}
      />
      <EditorToolbarButton
        icon={Bold}
        isApple={isApple}
        label={t("editor.format.bold")}
        onClick={() => chain().toggleBold().run()}
      />
      <EditorToolbarButton
        icon={Italic}
        isApple={isApple}
        label={t("editor.format.italic")}
        onClick={() => chain().toggleItalic().run()}
      />
      <EditorToolbarButton
        icon={Link}
        isApple={isApple}
        label={t("editor.format.link")}
        onClick={onLink}
      />
      <EditorToolbarButton
        icon={List}
        isApple={isApple}
        label={t("editor.blocks.bulletList")}
        onClick={() => chain().toggleBulletList().run()}
      />
      <EditorToolbarButton
        icon={ListChecks}
        isApple={isApple}
        label={t("editor.blocks.taskList")}
        onClick={() => chain().toggleTaskList().run()}
      />
      <EditorToolbarButton
        icon={IndentIncrease}
        isApple={isApple}
        label={t("editor.toolbar.indent")}
        onClick={() => chain().sinkListItem(currentListItem(editor)).run()}
      />
      <EditorToolbarButton
        icon={IndentDecrease}
        isApple={isApple}
        label={t("editor.toolbar.outdent")}
        onClick={() => chain().liftListItem(currentListItem(editor)).run()}
      />
      <EditorToolbarButton
        icon={Smile}
        isApple={isApple}
        label={t("editor.menu.emoji")}
        onClick={onEmoji}
      />
      <EditorToolbarButton
        icon={Undo2}
        isApple={isApple}
        label={t("editor.menu.undo")}
        onClick={() => chain().undo().run()}
      />
      <EditorToolbarButton
        icon={Redo2}
        isApple={isApple}
        label={t("editor.menu.redo")}
        onClick={() => chain().redo().run()}
      />
      <EditorToolbarButton
        icon={Ellipsis}
        isApple={isApple}
        label={t("editor.menu.label")}
        onClick={onMenu}
      />
    </div>
  );
}
