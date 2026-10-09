import {
  Bold,
  Bot,
  ClipboardPaste,
  Code,
  Copy,
  Italic,
  Link,
  Redo2,
  Scissors,
  SquareDashedMousePointer,
  Smile,
  Strikethrough,
  Type,
  Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  pasteFromClipboard,
  runClipboardCommand,
} from "@/app/components/editor/editor-clipboard";
import {
  AssistantItems,
  BlockActionItems,
  BlockKindItems,
  MenuEntry,
} from "@/app/components/editor/editor-menu-items";
import { returnFocus } from "@/app/components/editor/editor-geometry";
import { AnchoredMenu } from "@/app/components/editor/menus/anchored-menu";
import {
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/app/components/ui/dropdown-menu";
import { formatShortcut } from "@/app/lib/editor/editor-shortcuts";

import type { Editor } from "@tiptap/core";
import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";
import type { ScreenPoint } from "@/app/components/editor/menus/anchored-menu";

/** An open request for the context menu. */
export interface ContextMenuRequest extends ScreenPoint {
  /** Opens only the text assistant actions (`Mod+J`). */
  readonly showAssistant?: boolean;
}

interface EditorContextMenuProps {
  readonly editor: Editor;
  readonly request: ContextMenuRequest | null;
  readonly features: BlockEditorFeatures;
  readonly isApple: boolean;
  readonly onClose: () => void;
  readonly onLink: () => void;
  readonly onEmoji: () => void;
  readonly onNotice: (message: string) => void;
}

interface SectionProps {
  readonly editor: Editor;
  readonly isApple: boolean;
}

function ClipboardSection({
  editor,
  isApple,
  onNotice,
}: SectionProps & {
  readonly onNotice: (message: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { isEditable } = editor;
  const hasSelection = !editor.state.selection.empty;

  async function handlePaste(isPlain: boolean): Promise<void> {
    const outcome = await pasteFromClipboard(editor, isPlain);

    if (outcome !== "done") {
      onNotice(
        t("editor.notice.pasteRefused", {
          shortcut: formatShortcut(isPlain ? "pastePlain" : "paste", isApple),
        }),
      );
    }
  }

  return (
    <>
      <MenuEntry
        icon={Scissors}
        isApple={isApple}
        isDisabled={!isEditable || !hasSelection}
        label={t("editor.menu.cut")}
        shortcut="cut"
        onSelect={() => runClipboardCommand(editor, "cut")}
      />
      <MenuEntry
        icon={Copy}
        isApple={isApple}
        isDisabled={!hasSelection}
        label={t("editor.menu.copy")}
        shortcut="copy"
        onSelect={() => runClipboardCommand(editor, "copy")}
      />
      <MenuEntry
        icon={ClipboardPaste}
        isApple={isApple}
        isDisabled={!isEditable}
        label={t("editor.menu.paste")}
        shortcut="paste"
        onSelect={() => void handlePaste(false)}
      />
      <MenuEntry
        icon={Type}
        isApple={isApple}
        isDisabled={!isEditable}
        label={t("editor.menu.pastePlain")}
        shortcut="pastePlain"
        onSelect={() => void handlePaste(true)}
      />
      <MenuEntry
        icon={SquareDashedMousePointer}
        isApple={isApple}
        label={t("editor.menu.selectAll")}
        shortcut="selectAll"
        onSelect={() => editor.chain().focus().selectAll().run()}
      />
    </>
  );
}

function HistorySection({ editor, isApple }: SectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <MenuEntry
        icon={Undo2}
        isApple={isApple}
        isDisabled={!editor.isEditable || !editor.can().undo()}
        label={t("editor.menu.undo")}
        shortcut="undo"
        onSelect={() => editor.chain().focus().undo().run()}
      />
      <MenuEntry
        icon={Redo2}
        isApple={isApple}
        isDisabled={!editor.isEditable || !editor.can().redo()}
        label={t("editor.menu.redo")}
        shortcut="redo"
        onSelect={() => editor.chain().focus().redo().run()}
      />
    </>
  );
}

function FormatSection({
  editor,
  isApple,
  onLink,
}: SectionProps & { readonly onLink: () => void }): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={!editor.isEditable}>
        <Bold aria-hidden="true" className="mr-2 size-4" />
        {t("editor.menu.format")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <MenuEntry
          icon={Bold}
          isApple={isApple}
          label={t("editor.format.bold")}
          shortcut="bold"
          onSelect={() => editor.chain().focus().toggleBold().run()}
        />
        <MenuEntry
          icon={Italic}
          isApple={isApple}
          label={t("editor.format.italic")}
          shortcut="italic"
          onSelect={() => editor.chain().focus().toggleItalic().run()}
        />
        <MenuEntry
          icon={Strikethrough}
          isApple={isApple}
          label={t("editor.format.strike")}
          shortcut="strike"
          onSelect={() => editor.chain().focus().toggleStrike().run()}
        />
        <MenuEntry
          icon={Code}
          isApple={isApple}
          label={t("editor.format.code")}
          shortcut="code"
          onSelect={() => editor.chain().focus().toggleCode().run()}
        />
        <MenuEntry
          icon={Link}
          isApple={isApple}
          label={t("editor.format.link")}
          shortcut="link"
          onSelect={onLink}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function BlockSections({
  editor,
  isApple,
  features,
  onNotice,
}: SectionProps & {
  readonly features: BlockEditorFeatures;
  readonly onNotice: (message: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!editor.isEditable}>
          <Type aria-hidden="true" className="mr-2 size-4" />
          {t("editor.menu.turnInto")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <BlockKindItems editor={editor} isApple={isApple} position={null} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!editor.isEditable}>
          <Copy aria-hidden="true" className="mr-2 size-4" />
          {t("editor.menu.block")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <BlockActionItems
            editor={editor}
            features={features}
            isApple={isApple}
            position={null}
            onNotice={onNotice}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

/**
 * The context menu of the editor: clipboard, undo, formatting, block
 * actions and the text assistant, each with its shortcut. It opens at the
 * pointer, or at the caret for the keyboard, and leaves the selection as it
 * was. Reading without the right to write keeps copy and select all.
 */
export function EditorContextMenu({
  editor,
  request,
  features,
  isApple,
  onClose,
  onLink,
  onEmoji,
  onNotice,
}: EditorContextMenuProps): React.ReactElement {
  const { t } = useTranslation();
  const isEditable = editor.isEditable;

  if (request?.showAssistant === true) {
    return (
      <AnchoredMenu
        anchor={request}
        label={t("editor.menu.assistant")}
        onClose={onClose}
        onReturnFocus={() => returnFocus(editor)}
      >
        <AssistantItems features={features} isApple={isApple} />
      </AnchoredMenu>
    );
  }

  return (
    <AnchoredMenu
      anchor={request}
      label={t("editor.menu.label")}
      onClose={onClose}
      onReturnFocus={() => returnFocus(editor)}
    >
      <ClipboardSection editor={editor} isApple={isApple} onNotice={onNotice} />
      <HistorySection editor={editor} isApple={isApple} />
      <DropdownMenuSeparator />
      <FormatSection editor={editor} isApple={isApple} onLink={onLink} />
      <BlockSections
        editor={editor}
        features={features}
        isApple={isApple}
        onNotice={onNotice}
      />
      <MenuEntry
        icon={Smile}
        isApple={isApple}
        isDisabled={!isEditable}
        label={t("editor.menu.emoji")}
        onSelect={onEmoji}
      />
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Bot aria-hidden="true" className="mr-2 size-4" />
          {t("editor.menu.assistant")}
          <span className="ml-auto pl-4 text-xs text-muted-foreground">
            {formatShortcut("textAssistant", isApple)}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <AssistantItems features={features} isApple={isApple} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </AnchoredMenu>
  );
}
