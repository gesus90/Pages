import { useEffect, useRef } from "react";

import { useChatMenuRequest } from "./chat-menu-request";

import type { VirtualChatSelection } from "@/definition/VirtualChat";
import type { ChatMenuPoint } from "./chat-menu-request";

/** How long a finger rests on an entry until the menu opens. */
export const LONG_PRESS_MS = 500;

/** How far a finger may move, in pixels, before the press counts as scrolling. */
const MOVE_TOLERANCE = 10;

/** The events of an entry of the list that open the chat menu. */
export interface ListEntryMenuHandlers {
  onContextMenu(event: React.MouseEvent<HTMLElement>): void;
  onPointerDown(event: React.PointerEvent<HTMLElement>): void;
  onPointerMove(event: React.PointerEvent<HTMLElement>): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onPointerLeave(): void;
  onClickCapture(event: React.MouseEvent<HTMLElement>): void;
}

/** Stops a pending long press. */
function clearTimer(
  timer: React.RefObject<ReturnType<typeof setTimeout> | null>,
): void {
  if (timer.current !== null) clearTimeout(timer.current);
  timer.current = null;
}

/**
 * The point of a right click; the context menu key of the keyboard has no
 * pointer, so the menu opens below the entry then.
 */
function contextMenuPoint(event: React.MouseEvent<HTMLElement>): ChatMenuPoint {
  if (event.clientX !== 0 || event.clientY !== 0)
    return { x: event.clientX, y: event.clientY };
  const box = event.currentTarget.getBoundingClientRect();
  return { x: box.left + 16, y: box.bottom };
}

/**
 * Opens the chat menu of one conversation of the list with a right click,
 * and with a long press of a finger or pen on tablets and phones.
 * @remarks
 * The menu belongs to the opened chat, as its entries open the dialogs and
 * the column beside it; so the press opens the conversation first and then
 * its menu at the point. The click that follows a long press does nothing.
 * @param selection - The conversation of the entry.
 * @param onSelect - Opens the conversation, as a click on the entry does.
 */
export function useListEntryMenu(
  selection: VirtualChatSelection,
  onSelect: () => void,
): ListEntryMenuHandlers {
  const menu = useChatMenuRequest();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<ChatMenuPoint | null>(null);
  const hasPressed = useRef(false);

  function cancel(): void {
    clearTimer(timer);
  }

  useEffect(() => () => clearTimer(timer), []);

  function openAt(point: ChatMenuPoint): void {
    onSelect();
    menu.open(selection, point);
  }

  return {
    onContextMenu: (event) => {
      event.preventDefault();
      // A long press of a finger fires a context menu, too; it opened already.
      if (hasPressed.current) return;
      cancel();
      openAt(contextMenuPoint(event));
    },
    onPointerDown: (event) => {
      hasPressed.current = false;
      if (event.pointerType === "mouse") return;
      cancel();
      const point = { x: event.clientX, y: event.clientY };
      start.current = point;
      timer.current = setTimeout(() => {
        timer.current = null;
        hasPressed.current = true;
        openAt(point);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      const origin = start.current;
      if (timer.current === null || origin === null) return;
      const distance = Math.hypot(
        event.clientX - origin.x,
        event.clientY - origin.y,
      );
      if (distance > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: (event) => {
      if (!hasPressed.current) return;
      hasPressed.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
