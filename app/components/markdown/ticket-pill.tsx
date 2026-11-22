import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useFloatingStyle } from "@/app/components/editor/menus/use-floating-style";
import {
  TICKET_CARD_CLASS,
  TICKET_CARD_KEY_CLASS,
  TICKET_CARD_PERSON_CLASS,
  TICKET_CARD_STATUS_CLASS,
  TICKET_CARD_TITLE_CLASS,
  TICKET_PILL_CLASS,
  TICKET_PILL_STATUS_CLASS,
  ticketDotClass,
} from "@/app/components/markdown/ticket-pill-style";
import {
  getTicketSummary,
  refreshTicketSummaries,
  subscribeTicketSummaries,
  watchTicketSummary,
} from "@/app/lib/wiki-ticket-summaries";

import type { Editor } from "@tiptap/core";
import type { TicketSummaryState } from "@/app/lib/wiki-ticket-summaries";
import type { WikiTicketSummary } from "@/definition/Wiki";

/** Time the pointer rests on a ticket link before its preview opens. */
const PREVIEW_DELAY_MS = 300;
/** Selector of every element that shows a ticket preview. */
const TICKET_TARGET = "[data-ticket-key]";

interface TicketLinkProps {
  /** In-app address of the ticket, as written in the markdown. */
  readonly path: string;
  readonly ticketKey: string;
}

/** The ticket link the preview belongs to. */
interface PreviewTarget {
  readonly key: string;
  readonly element: Element;
  readonly anchor: DOMRect;
  /** Whether the caret of the editor, not the pointer or focus, opened it. */
  readonly isCaret: boolean;
}

type SetPreviewTarget = React.Dispatch<
  React.SetStateAction<PreviewTarget | null>
>;

/**
 * Reads what a link knows about its ticket and keeps it current.
 * @param key - Ticket key of the link.
 * @returns The state, which changes in one step when the server answers.
 */
export function useTicketSummary(key: string): TicketSummaryState {
  useEffect(() => watchTicketSummary(key), [key]);

  return useSyncExternalStore(
    subscribeTicketSummaries,
    () => getTicketSummary(key),
    () => getTicketSummary(key),
  );
}

/**
 * The line under the title of a preview: status, person and version.
 * @param summary - The ticket.
 * @param labels - Translated words for the status and a missing person.
 * @returns The line, parts joined by a middle dot.
 */
function previewDetails(
  summary: WikiTicketSummary,
  labels: { readonly status: string; readonly unassigned: string },
): string {
  return [
    `${labels.status} ${summary.statusName}`,
    summary.assigneeName ?? labels.unassigned,
    summary.milestoneName,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** The link of a ticket the person may not see: greyed, no status, no title. */
function UnavailableTicket({
  className,
  children,
}: {
  readonly className: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <span
      aria-disabled="true"
      className={className}
      data-state="hidden"
      role="link"
      title={t("wiki.ticketLink.unavailable")}
    >
      {children}
    </span>
  );
}

/**
 * A ticket link inside running text, shown as a pill with status dot, key
 * and status word; the markdown keeps the plain link.
 */
export function TicketPill({
  path,
  ticketKey,
  children,
}: TicketLinkProps & {
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const state = useTicketSummary(ticketKey);

  if (state.status === "hidden") {
    return (
      <UnavailableTicket className={TICKET_PILL_CLASS}>
        {children}
      </UnavailableTicket>
    );
  }

  return (
    <Link
      className={TICKET_PILL_CLASS}
      data-state={state.status}
      data-ticket-key={ticketKey}
      to={path}
    >
      <span aria-hidden="true" className={ticketDotClass(state)} />
      <span className="min-w-0 truncate">{children}</span>
      {state.status === "visible" ? (
        <span className={TICKET_PILL_STATUS_CLASS}>
          {state.summary.statusName}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * A ticket on its own line, shown as a card over the full text width:
 * status dot, key, shortened title, status pill and person.
 */
export function TicketCard({
  path,
  ticketKey,
}: TicketLinkProps): React.ReactElement {
  const state = useTicketSummary(ticketKey);

  if (state.status === "hidden") {
    return (
      <UnavailableTicket className={TICKET_CARD_CLASS}>
        <span className={TICKET_CARD_KEY_CLASS}>{ticketKey}</span>
      </UnavailableTicket>
    );
  }

  const summary = state.status === "visible" ? state.summary : null;

  return (
    <Link
      className={TICKET_CARD_CLASS}
      data-state={state.status}
      data-ticket-key={ticketKey}
      to={path}
    >
      <span aria-hidden="true" className={ticketDotClass(state)} />
      <span className={TICKET_CARD_KEY_CLASS}>{ticketKey}</span>
      <span className={TICKET_CARD_TITLE_CLASS}>{summary?.title}</span>
      {summary ? (
        <span className={TICKET_CARD_STATUS_CLASS}>{summary.statusName}</span>
      ) : null}
      {summary?.assigneeName ? (
        <span className={TICKET_CARD_PERSON_CLASS}>{summary.assigneeName}</span>
      ) : null}
    </Link>
  );
}

/** The card under a ticket link with title, status, person and version. */
function TicketPreviewCard({
  target,
}: {
  readonly target: PreviewTarget;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const state = useTicketSummary(target.key);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const style = useFloatingStyle(element, target.anchor);

  if (state.status !== "visible") {
    return null;
  }

  const { summary } = state;

  return createPortal(
    <div
      ref={setElement}
      className="pointer-events-none z-50 w-[300px] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-surface px-3.5 py-3 shadow-panel"
      role="tooltip"
      style={style}
    >
      <p className="line-clamp-2 text-sm font-semibold text-foreground">
        {summary.key} · {summary.title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {previewDetails(summary, {
          status: t("wiki.ticketLink.status"),
          unassigned: t("wiki.ticketLink.unassigned"),
        })}
      </p>
    </div>,
    document.body,
  );
}

function findTicketTarget(
  container: HTMLElement,
  node: EventTarget | null,
): HTMLElement | null {
  const element =
    node instanceof Element ? node.closest<HTMLElement>(TICKET_TARGET) : null;

  return element && container.contains(element) ? element : null;
}

function toTarget(element: HTMLElement, isCaret: boolean): PreviewTarget {
  return {
    anchor: element.getBoundingClientRect(),
    element,
    isCaret,
    key: element.dataset.ticketKey ?? "",
  };
}

/** Opens the preview 300 ms after the pointer came and at once on focus. */
function usePointerAndFocus(
  container: HTMLElement | null,
  setTarget: SetPreviewTarget,
): void {
  useEffect(() => {
    if (!container) {
      return undefined;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let isTouch = false;
    const close = (): void => {
      clearTimeout(timer);
      setTarget(null);
    };
    const onPointerDown = (event: PointerEvent): void => {
      isTouch = event.pointerType === "touch";
      close();
    };
    const onPointerOver = (event: PointerEvent): void => {
      const element = findTicketTarget(container, event.target);

      // Touch has no preview: a tap opens the ticket.
      if (!element || event.pointerType === "touch") {
        return;
      }

      clearTimeout(timer);
      timer = setTimeout(
        () => setTarget(toTarget(element, false)),
        PREVIEW_DELAY_MS,
      );
    };
    const onPointerOut = (event: PointerEvent): void => {
      const element = findTicketTarget(container, event.target);
      const isStillInside =
        event.relatedTarget instanceof Node &&
        element?.contains(event.relatedTarget) === true;

      if (element && !isStillInside) {
        close();
      }
    };
    const onFocusIn = (event: FocusEvent): void => {
      const element = findTicketTarget(container, event.target);

      if (element && !isTouch) {
        setTarget(toTarget(element, false));
      }
    };
    const onFocusOut = (event: FocusEvent): void => {
      if (findTicketTarget(container, event.target)) {
        close();
      }
    };
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointerover", onPointerOver);
    container.addEventListener("pointerout", onPointerOut);
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);

    return () => {
      clearTimeout(timer);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointerover", onPointerOver);
      container.removeEventListener("pointerout", onPointerOut);
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
    };
  }, [container, setTarget]);
}

/** In the editor the caret inside a ticket link counts as keyboard focus. */
function useCaretTarget(
  editor: Editor | null,
  setTarget: SetPreviewTarget,
): void {
  useEffect(() => {
    if (!editor) {
      return undefined;
    }

    const closeCaret = (): void =>
      setTarget((current) => (current?.isCaret ? null : current));
    const onSelection = (): void => {
      const { selection } = editor.state;

      if (!editor.isFocused || !selection.empty) {
        closeCaret();

        return;
      }

      const { node } = editor.view.domAtPos(selection.from);
      const element = findTicketTarget(
        editor.view.dom,
        node instanceof Element ? node : node.parentElement,
      );

      if (element) {
        setTarget(toTarget(element, true));
      } else {
        closeCaret();
      }
    };

    editor.on("selectionUpdate", onSelection);
    editor.on("blur", closeCaret);

    return () => {
      editor.off("selectionUpdate", onSelection);
      editor.off("blur", closeCaret);
    };
  }, [editor, setTarget]);
}

/** Escape, scrolling and a vanished link close an open preview. */
function useClosePreview(
  target: PreviewTarget | null,
  setTarget: SetPreviewTarget,
): void {
  useEffect(() => {
    if (!target) {
      return undefined;
    }

    const close = (): void => setTarget(null);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
      }
    };

    if (!target.element.isConnected) {
      close();
    }

    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", close, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [target, setTarget]);
}

/**
 * Reads the tickets of the shown links again when a page opens and when the
 * person comes back to the tab, quietly and without polling.
 */
function useTicketSummaryRefresh(): void {
  useEffect(() => {
    // Links that mount together with the text read new tickets anyway; a page
    // opened again reads the tickets it already knows once more. Both share
    // one request.
    refreshTicketSummaries();

    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        refreshTicketSummaries();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}

/**
 * Shows the preview of the ticket links inside a text: after 300 ms of
 * hovering, at once on keyboard focus or, in the editor, with the caret in
 * the link. Escape or moving away closes it; touch has none.
 * @remarks
 * Also reads the tickets of the links again when the text opens and when the
 * person returns to the tab.
 */
export function TicketPreviewLayer({
  container,
  editor = null,
}: {
  /** The element that holds the text with the ticket links. */
  readonly container: HTMLElement | null;
  readonly editor?: Editor | null;
}): React.ReactElement | null {
  const [target, setTarget] = useState<PreviewTarget | null>(null);

  useTicketSummaryRefresh();
  usePointerAndFocus(container, setTarget);
  useCaretTarget(editor, setTarget);
  useClosePreview(target, setTarget);

  return target ? <TicketPreviewCard key={target.key} target={target} /> : null;
}
