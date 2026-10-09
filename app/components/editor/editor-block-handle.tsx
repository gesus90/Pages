import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Bot, GripVertical, Plus, Type } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AssistantItems,
  BlockActionItems,
  BlockKindItems,
} from "@/app/components/editor/editor-menu-items";
import { returnFocus } from "@/app/components/editor/editor-geometry";
import { AnchoredMenu } from "@/app/components/editor/menus/anchored-menu";
import { useHoveredBlock } from "@/app/components/editor/use-hovered-block";
import {
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/app/components/ui/dropdown-menu";
import { findTopLevelBlock } from "@/app/lib/editor/editor-commands";
import { serializeMarkdownFragment } from "@/app/lib/editor/editor-markdown";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

import type { Editor } from "@tiptap/core";
import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";
import type { ScreenPoint } from "@/app/components/editor/menus/anchored-menu";

interface EditorBlockHandleProps {
  readonly editor: Editor;
  readonly container: HTMLElement | null;
  readonly features: BlockEditorFeatures;
  readonly isApple: boolean;
  readonly onNotice: (message: string) => void;
}

/**
 * Starts dragging a block: the block becomes the selection and ProseMirror
 * moves it to where it is dropped, showing the drop cursor on the way.
 *
 * @param editor - The editor.
 * @param position - Position right before the block.
 * @param event - The drag event of the handle.
 */
export function startBlockDrag(
  editor: Editor,
  position: number,
  event: React.DragEvent<HTMLElement>,
): void {
  const { view } = editor;
  const selection = NodeSelection.create(view.state.doc, position);
  const slice = selection.content();
  const element = view.nodeDOM(position);

  view.dispatch(view.state.tr.setSelection(selection));
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(
    "text/plain",
    serializeMarkdownFragment(slice.content),
  );

  if (element instanceof HTMLElement) {
    event.dataTransfer.setDragImage(element, 0, 0);
  }

  view.dragging = { move: true, slice };
}

/**
 * Adds an empty block below a block and opens the slash menu in it, as the
 * plus of the handle does in Notion.
 *
 * @param editor - The editor.
 * @param position - Position right before the block.
 */
export function addBlockBelow(editor: Editor, position: number): void {
  const block = findTopLevelBlock(editor.state.doc, position);

  if (!block) {
    return;
  }

  const after = block.position + block.node.nodeSize;
  const transaction = editor.state.tr.insert(
    after,
    editor.state.schema.node(EDITOR_NODE.paragraph),
  );

  transaction.setSelection(TextSelection.create(transaction.doc, after + 1));
  editor.view.dispatch(transaction);
  editor.chain().focus().insertContent("/").run();
}

/**
 * The handle left of the block under the pointer: plus adds a block below,
 * the grip opens the block menu on click and moves the block when dragged.
 * Keyboard and touch reach the same actions through the context menu.
 */
export function EditorBlockHandle({
  editor,
  container,
  features,
  isApple,
  onNotice,
}: EditorBlockHandleProps): React.ReactElement | null {
  const { t } = useTranslation();
  const hovered = useHoveredBlock(editor, container);
  const [menu, setMenu] = useState<{
    anchor: ScreenPoint;
    position: number;
  } | null>(null);

  function handleOpenMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    position: number,
  ): void {
    const bounds = event.currentTarget.getBoundingClientRect();

    setMenu({ anchor: { x: bounds.left, y: bounds.bottom }, position });
  }

  return (
    <>
      {hovered ? (
        <div
          className="absolute -left-14 flex items-center"
          contentEditable={false}
          style={{ top: hovered.top }}
        >
          <button
            aria-label={t("editor.handle.add")}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            tabIndex={-1}
            type="button"
            onClick={() => addBlockBelow(editor, hovered.position)}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
          <button
            aria-label={t("editor.handle.menu")}
            className="flex size-6 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            draggable
            tabIndex={-1}
            type="button"
            onClick={(event) => handleOpenMenu(event, hovered.position)}
            onDragStart={(event) =>
              startBlockDrag(editor, hovered.position, event)
            }
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
      <AnchoredMenu
        anchor={menu?.anchor ?? null}
        label={t("editor.handle.menu")}
        onClose={() => setMenu(null)}
        onReturnFocus={() => returnFocus(editor)}
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Type aria-hidden="true" className="mr-2 size-4" />
            {t("editor.menu.turnInto")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <BlockKindItems
              editor={editor}
              isApple={isApple}
              position={menu?.position ?? null}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <BlockActionItems
          editor={editor}
          features={features}
          isApple={isApple}
          position={menu?.position ?? null}
          onNotice={onNotice}
        />
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Bot aria-hidden="true" className="mr-2 size-4" />
            {t("editor.menu.assistant")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <AssistantItems features={features} isApple={isApple} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </AnchoredMenu>
    </>
  );
}
