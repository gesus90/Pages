import { useRef } from "react";

import type { PicaBrowserInput } from "@/definition/PicaBrowser";

/** How long typed characters wait for more before they are sent as one text. */
const TEXT_FLUSH_MS = 80;

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
]);

/** Keys that have a name of their own and are never typed as text. */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** The handlers that turn the pointer and keyboard over the picture into input of the administrator. */
export interface TakeoverHandlers {
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  readonly onPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
  readonly onWheel: (event: React.WheelEvent<HTMLElement>) => void;
}

interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * Relays pointer and keyboard input over the live picture to the page.
 *
 * @param send - Sends one input; calls arrive one after another in order.
 * @param viewport - The size of the page the picture shows, in its own pixels.
 * @returns Handlers for the element that shows the picture.
 */
export function useTakeoverInput(
  send: (input: PicaBrowserInput) => void,
  viewport: Viewport,
): TakeoverHandlers {
  const pending = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function flush(): void {
    clearTimeout(timer.current);
    if (!pending.current) return;
    const text = pending.current;
    pending.current = "";
    send({ type: "text", text });
  }

  function typeText(text: string): void {
    pending.current += text;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, TEXT_FLUSH_MS);
  }

  function point(event: React.MouseEvent<HTMLElement>): {
    x: number;
    y: number;
  } {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * viewport.width) / rect.width,
      y: ((event.clientY - rect.top) * viewport.height) / rect.height,
    };
  }

  return {
    onPointerDown: (event) => {
      event.currentTarget.focus();
      flush();
      send({ type: "click", ...point(event) });
    },
    onWheel: (event) => {
      flush();
      send({
        type: "scroll",
        ...point(event),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    },
    onPaste: (event) => {
      event.preventDefault();
      const text = event.clipboardData.getData("text").slice(0, 500);
      if (text) typeText(text);
    },
    onKeyDown: (event) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      const hasShortcut = event.ctrlKey || event.metaKey || event.altKey;
      if (event.key.length === 1 && !hasShortcut) {
        event.preventDefault();
        typeText(event.key);
        return;
      }
      if (
        NAMED_KEYS.has(event.key) ||
        (hasShortcut && event.key.length === 1)
      ) {
        // The paste event carries the clipboard; a shortcut for it must not also reach the page.
        if (event.key.toLowerCase() === "v" && hasShortcut) return;
        event.preventDefault();
        flush();
        const modifier = event.ctrlKey || event.metaKey ? "ControlOrMeta+" : "";
        send({ type: "key", key: `${modifier}${event.key}` });
      }
    },
  };
}
