import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Ellipsis,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Paperclip,
  Pilcrow,
  Quote,
  Redo2,
  Smile,
  SquareCode,
  Strikethrough,
  Table,
  Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  EditorToolbarButton,
  moveToolbarFocus,
} from "@/app/components/editor/editor-toolbar-button";
import { insertBlock, turnBlockInto } from "@/app/lib/editor/editor-commands";
import { EDITOR_MARK, EDITOR_NODE } from "@/app/lib/editor/editor-schema";

import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";
import type { BlockKind } from "@/app/lib/editor/editor-commands";
import type { EditorShortcut } from "@/app/lib/editor/editor-shortcuts";

interface EditorFixedToolbarProps {
  readonly editor: Editor;
  readonly features: BlockEditorFeatures;
  readonly isApple: boolean;
  readonly onLink: () => void;
  readonly onEmoji: () => void;
  readonly onFiles: () => void;
  readonly onMenu: () => void;
}

interface BlockButton {
  /** A block type that has a shortcut of its own. */
  readonly kind: Extract<BlockKind, EditorShortcut>;
  readonly icon: LucideIcon;
  readonly label: string;
}

const STYLE_BUTTONS: readonly BlockButton[] = [
  { icon: Pilcrow, kind: "paragraph", label: "editor.blocks.paragraph" },
  { icon: Heading1, kind: "heading1", label: "editor.blocks.heading1" },
  { icon: Heading2, kind: "heading2", label: "editor.blocks.heading2" },
  { icon: Heading3, kind: "heading3", label: "editor.blocks.heading3" },
];

const LIST_BUTTONS: readonly BlockButton[] = [
  { icon: List, kind: "bulletList", label: "editor.blocks.bulletList" },
  {
    icon: ListOrdered,
    kind: "orderedList",
    label: "editor.blocks.orderedList",
  },
  { icon: ListChecks, kind: "taskList", label: "editor.blocks.taskList" },
  { icon: Quote, kind: "quote", label: "editor.blocks.quote" },
  { icon: SquareCode, kind: "codeBlock", label: "editor.blocks.codeBlock" },
];

/** Which marks and block types apply at the selection. */
type ActiveState = Readonly<Record<string, boolean>>;

function readActiveState(editor: Editor): ActiveState {
  return {
    bold: editor.isActive(EDITOR_MARK.bold),
    bulletList: editor.isActive(EDITOR_NODE.bulletList),
    code: editor.isActive(EDITOR_MARK.code),
    codeBlock: editor.isActive(EDITOR_NODE.codeBlock),
    heading1: editor.isActive(EDITOR_NODE.heading, { level: 1 }),
    heading2: editor.isActive(EDITOR_NODE.heading, { level: 2 }),
    heading3: editor.isActive(EDITOR_NODE.heading, { level: 3 }),
    italic: editor.isActive(EDITOR_MARK.italic),
    link: editor.isActive(EDITOR_MARK.link),
    orderedList: editor.isActive(EDITOR_NODE.orderedList),
    paragraph: editor.isActive(EDITOR_NODE.paragraph),
    quote: editor.isActive(EDITOR_NODE.blockquote),
    strike: editor.isActive(EDITOR_MARK.strike),
    taskList: editor.isActive(EDITOR_NODE.taskList),
  };
}

function Divider(): React.ReactElement {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />;
}

/** Bold, italic, strike, code and link at the selection. */
function MarkButtons({
  editor,
  active,
  isApple,
  onLink,
}: {
  readonly editor: Editor;
  readonly active: ActiveState;
  readonly isApple: boolean;
  readonly onLink: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const chain = (): ReturnType<Editor["chain"]> => editor.chain().focus();

  return (
    <>
      <EditorToolbarButton
        icon={Bold}
        isActive={active.bold}
        isApple={isApple}
        label={t("editor.format.bold")}
        shortcut="bold"
        onClick={() => chain().toggleBold().run()}
      />
      <EditorToolbarButton
        icon={Italic}
        isActive={active.italic}
        isApple={isApple}
        label={t("editor.format.italic")}
        shortcut="italic"
        onClick={() => chain().toggleItalic().run()}
      />
      <EditorToolbarButton
        icon={Strikethrough}
        isActive={active.strike}
        isApple={isApple}
        label={t("editor.format.strike")}
        shortcut="strike"
        onClick={() => chain().toggleStrike().run()}
      />
      <EditorToolbarButton
        icon={Code}
        isActive={active.code}
        isApple={isApple}
        label={t("editor.format.code")}
        shortcut="code"
        onClick={() => chain().toggleCode().run()}
      />
      <EditorToolbarButton
        icon={Link}
        isActive={active.link}
        isApple={isApple}
        label={t("editor.format.link")}
        shortcut="link"
        onClick={onLink}
      />
    </>
  );
}

/** Table, attachment, emoji, undo, redo and the editor menu. */
function InsertButtons({
  editor,
  features,
  isApple,
  onEmoji,
  onFiles,
  onMenu,
}: Omit<EditorFixedToolbarProps, "onLink">): React.ReactElement {
  const { t } = useTranslation();
  const chain = (): ReturnType<Editor["chain"]> => editor.chain().focus();

  return (
    <>
      <EditorToolbarButton
        icon={Table}
        isApple={isApple}
        label={t("editor.blocks.table")}
        onClick={() => insertBlock(editor, "table")}
      />
      <EditorToolbarButton
        icon={Paperclip}
        isApple={isApple}
        isDisabled={!features.uploadFiles}
        label={t("editor.blocks.file")}
        onClick={onFiles}
      />
      <EditorToolbarButton
        icon={Smile}
        isApple={isApple}
        label={t("editor.menu.emoji")}
        onClick={onEmoji}
      />
      <Divider />
      <EditorToolbarButton
        icon={Undo2}
        isApple={isApple}
        label={t("editor.menu.undo")}
        shortcut="undo"
        onClick={() => chain().undo().run()}
      />
      <EditorToolbarButton
        icon={Redo2}
        isApple={isApple}
        label={t("editor.menu.redo")}
        shortcut="redo"
        onClick={() => chain().redo().run()}
      />
      <EditorToolbarButton
        icon={Ellipsis}
        isApple={isApple}
        label={t("editor.menu.label")}
        shortcut="contextMenu"
        onClick={onMenu}
      />
    </>
  );
}

/**
 * The compact toolbar above the text, as Jira shows it above a description:
 * text styles, marks, lists and blocks, table, attachment and emoji, undo and
 * redo, and the editor menu. It runs the same commands as shortcuts, slash
 * menu and context menu; touch devices keep the mobile toolbar instead.
 */
export function EditorFixedToolbar(
  props: EditorFixedToolbarProps,
): React.ReactElement {
  const { editor, isApple, onLink } = props;
  const { t } = useTranslation();
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => readActiveState(current),
  });

  function blockButton(button: BlockButton): React.ReactElement {
    return (
      <EditorToolbarButton
        key={button.kind}
        icon={button.icon}
        isActive={active[button.kind]}
        isApple={isApple}
        label={t(button.label)}
        shortcut={button.kind}
        onClick={() => turnBlockInto(editor, button.kind)}
      />
    );
  }

  return (
    <div
      aria-label={t("editor.toolbar.label")}
      className="sticky top-16 z-10 hidden flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface p-1 md:flex"
      role="toolbar"
      onKeyDown={moveToolbarFocus}
    >
      {STYLE_BUTTONS.map(blockButton)}
      <Divider />
      <MarkButtons
        active={active}
        editor={editor}
        isApple={isApple}
        onLink={onLink}
      />
      <Divider />
      {LIST_BUTTONS.map(blockButton)}
      <Divider />
      <InsertButtons {...props} />
    </div>
  );
}
