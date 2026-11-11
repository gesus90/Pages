import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { CHAT_SPLIT_MINIMUM_WIDTH } from "@/definition/ConversationContent";

import { CardPanel } from "./card-panel";
import { useChatContent } from "./chat-content-context";

/** The width of the split view before the person changed it. */
const DEFAULT_WIDTH = 560;
const KEYBOARD_STEP = 32;

/** The width of the panel, dragged at the divider and remembered for the person. */
function useSplitWidth(stored: number | null): {
  readonly width: number;
  readonly handlers: Pick<
    React.HTMLAttributes<HTMLDivElement>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onKeyDown"
  >;
} {
  const saver = useFetcher();
  const [width, setWidth] = useState(stored ?? DEFAULT_WIDTH);
  const drag = useRef<{
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);

  /** Keeps at least 360 px for the panel and for the chat left of it. */
  function clamp(wanted: number, divider: HTMLElement): number {
    const row = divider.parentElement;
    const chat = divider.previousElementSibling;
    const available =
      row && chat instanceof HTMLElement
        ? chat.getBoundingClientRect().width + width
        : wanted + CHAT_SPLIT_MINIMUM_WIDTH;
    return Math.round(
      Math.max(
        CHAT_SPLIT_MINIMUM_WIDTH,
        Math.min(wanted, available - CHAT_SPLIT_MINIMUM_WIDTH),
      ),
    );
  }

  function save(next: number): void {
    const formData = new FormData();
    formData.set("intent", "split-width");
    formData.set("width", String(next));
    void saver.submit(formData, { method: "post" });
  }

  return {
    width,
    handlers: {
      onPointerDown: (event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width };
      },
      onPointerMove: (event) => {
        const start = drag.current;
        if (!start) return;
        setWidth(
          clamp(
            start.startWidth + start.startX - event.clientX,
            event.currentTarget,
          ),
        );
      },
      onPointerUp: (event) => {
        if (!drag.current) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        save(width);
      },
      onKeyDown: (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = event.key === "ArrowLeft" ? KEYBOARD_STEP : -KEYBOARD_STEP;
        const next = clamp(width + step, event.currentTarget);
        setWidth(next);
        save(next);
      },
    },
  };
}

/**
 * The split view right of the chat (PAGE-298): the one card opened with
 * "Daneben", behind a divider that changes its width.
 *
 * @remarks
 * The chat stays usable left of it. Dragging the divider, or the arrow
 * keys on it, changes the width; at least 360 px remain for either side, and
 * the width is remembered for the person. Renders nothing while no card is
 * opened.
 *
 * @param storedWidth - The width the person chose last, or `null`.
 */
export function SplitPanel({
  storedWidth,
}: {
  readonly storedWidth: number | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { beside, closeBeside, openOverlay } = useChatContent();
  const split = useSplitWidth(storedWidth);
  if (!beside) return null;
  return (
    <>
      <div
        aria-label={t("chatPage.cards.resize")}
        aria-orientation="vertical"
        aria-valuemin={CHAT_SPLIT_MINIMUM_WIDTH}
        aria-valuenow={split.width}
        className="group -mx-3 flex w-3 shrink-0 cursor-col-resize touch-none justify-center focus-visible:outline-none"
        data-split-divider=""
        role="separator"
        tabIndex={0}
        {...split.handlers}
      >
        <span className="h-full w-px bg-border group-hover:w-0.5 group-hover:bg-primary group-focus-visible:w-0.5 group-focus-visible:bg-primary" />
      </div>
      <CardPanel
        card={beside}
        className="shrink-0 rounded-[14px] border border-border shadow-card"
        onClose={closeBeside}
        onFullscreen={() => openOverlay(beside)}
        // The width belongs to the person, so it is the one inline style here.
        style={{ width: split.width, minWidth: CHAT_SPLIT_MINIMUM_WIDTH }}
      />
    </>
  );
}
