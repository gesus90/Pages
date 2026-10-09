import { NodeSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Bot,
  Code,
  Italic,
  Link,
  MessageSquareQuote,
  Strikethrough,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  EditorToolbarButton,
  moveToolbarFocus,
} from "@/app/components/editor/editor-toolbar-button";
import { EDITOR_MARK } from "@/app/lib/editor/editor-schema";

import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";

interface EditorSelectionToolbarProps {
  readonly editor: Editor;
  readonly features: BlockEditorFeatures;
  readonly isApple: boolean;
  readonly onLink: () => void;
}

interface ActiveMarks {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strike: boolean;
  readonly code: boolean;
  readonly link: boolean;
}

/**
 * Tells whether the toolbar belongs to a selection: text is selected in an
 * editable document, outside of code, where formatting does not apply.
 *
 * @param editor - The editor.
 * @param state - The editor state.
 * @returns Whether the toolbar shows.
 */
export function shouldShowSelectionToolbar(
  editor: Editor,
  state: EditorState,
): boolean {
  const { selection } = state;

  return (
    editor.isEditable &&
    !selection.empty &&
    !(selection instanceof NodeSelection) &&
    selection.$from.parent.type.spec.code !== true
  );
}

/**
 * The formatting bar above selected text (as in Notion): bold, italic,
 * strike, code, link, a comment on the passage and the text assistant.
 */
export function EditorSelectionToolbar({
  editor,
  features,
  isApple,
  onLink,
}: EditorSelectionToolbarProps): React.ReactElement {
  const { t } = useTranslation();
  const marks = useEditorState<ActiveMarks>({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive(EDITOR_MARK.bold),
      code: current.isActive(EDITOR_MARK.code),
      italic: current.isActive(EDITOR_MARK.italic),
      link: current.isActive(EDITOR_MARK.link),
      strike: current.isActive(EDITOR_MARK.strike),
    }),
  });
  const chain = (): ReturnType<Editor["chain"]> => editor.chain().focus();

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top" }}
      shouldShow={({ editor: current, state }) =>
        shouldShowSelectionToolbar(current, state)
      }
    >
      <div
        aria-label={t("editor.toolbar.label")}
        className="pages-floating-panel flex items-center gap-0.5 p-1"
        role="toolbar"
        onKeyDown={moveToolbarFocus}
      >
        <EditorToolbarButton
          icon={Bold}
          isActive={marks.bold}
          isApple={isApple}
          label={t("editor.format.bold")}
          shortcut="bold"
          onClick={() => chain().toggleBold().run()}
        />
        <EditorToolbarButton
          icon={Italic}
          isActive={marks.italic}
          isApple={isApple}
          label={t("editor.format.italic")}
          shortcut="italic"
          onClick={() => chain().toggleItalic().run()}
        />
        <EditorToolbarButton
          icon={Strikethrough}
          isActive={marks.strike}
          isApple={isApple}
          label={t("editor.format.strike")}
          shortcut="strike"
          onClick={() => chain().toggleStrike().run()}
        />
        <EditorToolbarButton
          icon={Code}
          isActive={marks.code}
          isApple={isApple}
          label={t("editor.format.code")}
          shortcut="code"
          onClick={() => chain().toggleCode().run()}
        />
        <EditorToolbarButton
          icon={Link}
          isActive={marks.link}
          isApple={isApple}
          label={t("editor.format.link")}
          shortcut="link"
          onClick={onLink}
        />
        {features.comment ? (
          <EditorToolbarButton
            icon={MessageSquareQuote}
            isApple={isApple}
            label={t("editor.toolbar.comment")}
            onClick={features.comment}
          />
        ) : null}
        <EditorToolbarButton
          icon={Bot}
          isApple={isApple}
          isDisabled={!features.textAssistant}
          label={
            features.textAssistant
              ? t("editor.menu.assistant")
              : t("editor.assistant.unavailable")
          }
          shortcut="textAssistant"
          onClick={() => features.textAssistant?.open()}
        />
      </div>
    </BubbleMenu>
  );
}
