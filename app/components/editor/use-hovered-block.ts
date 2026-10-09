import { useEffect, useState } from "react";

import { findTopLevelBlock } from "@/app/lib/editor/editor-commands";

import type { Editor } from "@tiptap/core";

/** The top-level block under the pointer and where it is drawn. */
export interface HoveredBlock {
  /** Position right before the block. */
  readonly position: number;
  /** Distance of the block's top from the top of the container. */
  readonly top: number;
}

/**
 * Finds the top-level block at a point of the screen.
 *
 * @param editor - The editor.
 * @param container - The element the handle is placed in.
 * @param point - Pointer coordinates in the viewport.
 * @returns The block and its offset in the container, or `null`.
 *
 * @remarks
 * Points left of the text, where the handle is, count as the line they are
 * on, so moving from the text to the handle keeps the block.
 */
export function findBlockAtPoint(
  editor: Editor,
  container: HTMLElement,
  point: { readonly x: number; readonly y: number },
): HoveredBlock | null {
  const { view } = editor;
  const bounds = view.dom.getBoundingClientRect();
  const found = view.posAtCoords({
    left: Math.max(point.x, bounds.left + 1),
    top: point.y,
  });
  const block = found
    ? findTopLevelBlock(
        editor.state.doc,
        found.inside >= 0 ? found.inside : found.pos,
      )
    : null;
  const element = block ? view.nodeDOM(block.position) : null;

  if (!block || !(element instanceof HTMLElement)) {
    return null;
  }

  return {
    position: block.position,
    top:
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top,
  };
}

/**
 * Follows the block under the pointer while the pointer is over the editor.
 * Typing hides the handle, as in Notion, until the pointer moves again.
 *
 * @param editor - The editor.
 * @param container - The element around the editor and its handle.
 * @returns The hovered block, or `null`.
 */
export function useHoveredBlock(
  editor: Editor,
  container: HTMLElement | null,
): HoveredBlock | null {
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);

  useEffect(() => {
    if (!container) {
      return undefined;
    }

    const handleMove = (event: MouseEvent): void => {
      const block = findBlockAtPoint(editor, container, {
        x: event.clientX,
        y: event.clientY,
      });

      setHovered((current) =>
        current?.position === block?.position && current?.top === block?.top
          ? current
          : block,
      );
    };
    const handleLeave = (): void => setHovered(null);

    container.addEventListener("mousemove", handleMove);
    container.addEventListener("mouseleave", handleLeave);
    editor.view.dom.addEventListener("keydown", handleLeave);

    return () => {
      container.removeEventListener("mousemove", handleMove);
      container.removeEventListener("mouseleave", handleLeave);
      editor.view.dom.removeEventListener("keydown", handleLeave);
    };
  }, [editor, container]);

  return hovered;
}
