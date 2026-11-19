import { GripHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { QuotaCardSort } from "./use-quota-card-sort";

/**
 * The handle of a quota card: the one place that moves it.
 * @remarks
 * The handle stands at the top edge of the card, centred, so it never covers
 * the name, the plan badge or the retry button of the status line. It is a
 * real button: a mouse, a finger or a pen drags it, and the keyboard picks
 * the card up with Enter or Space. The browser does not scroll or zoom when a
 * finger starts on it, so the drag follows the finger. `aria-pressed` tells
 * a screen reader that the keyboard holds the card.
 */
export function QuotaCardHandle({
  connectionId,
  name,
  sort,
  descriptionId,
}: {
  readonly connectionId: string;
  readonly name: string;
  readonly sort: QuotaCardSort;
  /** The element that explains the keys; the handle points to it. */
  readonly descriptionId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { session } = sort;
  const isHeldByKeyboard =
    session?.source === "keyboard" && session.activeId === connectionId;
  const label = t("agentsPage.order.handle", { name });
  return (
    <button
      type="button"
      data-quota-handle={connectionId}
      aria-label={label}
      title={label}
      aria-pressed={isHeldByKeyboard}
      aria-describedby={descriptionId}
      onPointerDown={(event) => sort.startPointerDrag(event, connectionId)}
      onKeyDown={(event) => sort.handleKeyDown(event, connectionId)}
      onBlur={() => sort.handleBlur(connectionId)}
      className="absolute top-0.5 left-1/2 z-10 flex h-6 w-14 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground outline-none select-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
    >
      <GripHorizontal className="size-4" aria-hidden="true" />
    </button>
  );
}
