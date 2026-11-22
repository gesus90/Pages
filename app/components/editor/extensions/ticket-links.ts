import { Extension } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import {
  TICKET_CARD_PERSON_CLASS,
  TICKET_CARD_STATUS_CLASS,
  TICKET_CARD_TITLE_CLASS,
  TICKET_PILL_CLASS,
  TICKET_PILL_STATUS_CLASS,
  ticketDotClass,
} from "@/app/components/markdown/ticket-pill-style";
import { cn } from "@/app/lib/cn";
import {
  EDITOR_MARK,
  EDITOR_NODE,
  readTextAttribute,
} from "@/app/lib/editor/editor-schema";
import {
  getTicketSummary,
  readTicketKey,
  subscribeTicketSummaries,
  watchTicketSummary,
} from "@/app/lib/wiki-ticket-summaries";

import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView, MarkView, ViewMutationRecord } from "@tiptap/pm/view";
import type { TicketSummaryState } from "@/app/lib/wiki-ticket-summaries";

/** What ticket links in the editor need from the application. */
export interface TicketLinkOptions {
  /** Whether ticket links are shown as pills in this editor. */
  readonly isEnabled: () => boolean;
  /** Opens the ticket of a link; `inNewTab` for Ctrl or Cmd. */
  readonly open: (path: string, inNewTab: boolean) => void;
  /** Tooltip of a link to a ticket the person may not see. */
  readonly unavailableLabel: () => string;
}

/** The parts of a ticket pill that only Pages writes into. */
interface PillParts {
  readonly link: HTMLElement;
  readonly dot: HTMLElement;
  readonly status: HTMLElement;
  readonly title: HTMLElement;
  readonly side: HTMLElement;
  readonly chip: HTMLElement;
  readonly person: HTMLElement;
}

const TICKET_LINKS_KEY = new PluginKey<DecorationSet>("ticketLinks");

/**
 * Classes the card of a ticket block gives its paragraph; the pill inside
 * then spreads over the card.
 */
const BLOCK_CLASS =
  "my-2 flex h-11 items-center rounded-xl border border-border bg-surface px-3.5";

/** Pill parts that only the card of a ticket block shows. */
const IN_BLOCK = "hidden [[data-ticket-block]_&]:inline-flex";

/** The pill becomes the content row of the card inside a ticket block. */
const PILL_IN_BLOCK =
  "[[data-ticket-block]_&]:h-auto [[data-ticket-block]_&]:w-full [[data-ticket-block]_&]:gap-2.5 [[data-ticket-block]_&]:border-0 [[data-ticket-block]_&]:bg-transparent [[data-ticket-block]_&]:px-0 [[data-ticket-block]_&]:text-sm";

function readLinkPath(mark: Mark): string | null {
  const href = readTextAttribute(mark.attrs, "href");

  return href !== null && readTicketKey(href) !== null ? href : null;
}

function readTextLinkPath(text: ProseMirrorNode): string | null {
  const link = text.marks.find((mark) => mark.type.name === EDITOR_MARK.link);

  return link ? readLinkPath(link) : null;
}

/**
 * The address of the ticket a top-level paragraph links to when the link is
 * all it holds, the markdown of a ticket block; blanks around it count as
 * nothing.
 */
function readBlockPath(paragraph: ProseMirrorNode): string | null {
  const paths = new Set<string | null>();

  paragraph.forEach((child) => {
    const path = child.isText ? readTextLinkPath(child) : null;

    if (path !== null || !child.isText || child.textContent.trim() !== "") {
      paths.add(path);
    }
  });

  const [path = null] = paths;

  return paths.size === 1 ? path : null;
}

function findBlockDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.forEach((node, offset) => {
    if (node.type.name === EDITOR_NODE.paragraph && readBlockPath(node)) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: BLOCK_CLASS,
          "data-ticket-block": "",
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function createPart(
  tag: string,
  className: string,
  isDecoration: boolean,
): HTMLElement {
  const element = document.createElement(tag);

  element.className = className;

  if (isDecoration) {
    element.contentEditable = "false";
  }

  return element;
}

/** Writes what is known about the ticket into the pill, in one step. */
function renderPill(
  parts: PillParts,
  state: TicketSummaryState,
  unavailableLabel: string,
): void {
  const summary = state.status === "visible" ? state.summary : null;
  const isHidden = state.status === "hidden";

  parts.link.dataset.state = state.status;

  if (isHidden) {
    parts.link.title = unavailableLabel;
    parts.link.setAttribute("aria-disabled", "true");
  } else {
    parts.link.removeAttribute("title");
    parts.link.removeAttribute("aria-disabled");
  }

  parts.dot.className = ticketDotClass(state);
  parts.status.textContent = summary?.statusName ?? "";
  parts.status.hidden = summary === null;
  parts.title.textContent = summary?.title ?? "";
  parts.side.hidden = summary === null;
  parts.chip.textContent = summary?.statusName ?? "";
  parts.person.textContent = summary?.assigneeName ?? "";
  parts.person.hidden = !summary?.assigneeName;
}

/** Builds the pill of a ticket link around the editable link text. */
function createPill(
  link: HTMLElement,
  key: string,
): { readonly parts: PillParts; readonly contentDOM: HTMLElement } {
  const contentDOM = createPart("span", "min-w-0 truncate", false);
  const side = createPart(
    "span",
    cn(IN_BLOCK, "ml-auto shrink-0 items-center gap-2.5"),
    true,
  );
  const parts: PillParts = {
    chip: createPart("span", TICKET_CARD_STATUS_CLASS, false),
    dot: createPart("span", "", true),
    link,
    person: createPart("span", TICKET_CARD_PERSON_CLASS, false),
    side,
    status: createPart(
      "span",
      cn(TICKET_PILL_STATUS_CLASS, "[[data-ticket-block]_&]:hidden"),
      true,
    ),
    title: createPart("span", cn(TICKET_CARD_TITLE_CLASS, IN_BLOCK), true),
  };

  parts.dot.setAttribute("aria-hidden", "true");
  side.append(parts.chip, parts.person);
  link.className = cn(TICKET_PILL_CLASS, PILL_IN_BLOCK);
  link.dataset.ticketKey = key;
  link.append(parts.dot, contentDOM, parts.status, parts.title, side);

  return { contentDOM, parts };
}

/**
 * The view of a link mark: ticket links become pills that follow their
 * ticket, every other link stays as the schema renders it.
 */
function createLinkView(
  mark: Mark,
  inline: boolean,
  options: TicketLinkOptions,
): MarkView {
  const spec = mark.type.spec.toDOM?.(mark, inline) ?? (["a", 0] as const);
  const rendered = DOMSerializer.renderSpec(document, spec);
  const path = readLinkPath(mark);
  const key = path === null ? null : readTicketKey(path);

  if (!(rendered.dom instanceof HTMLElement)) {
    throw new Error("The link mark must render an element.");
  }

  if (path === null || key === null || !options.isEnabled()) {
    return { contentDOM: rendered.contentDOM, dom: rendered.dom };
  }

  const link = rendered.dom;
  const { contentDOM, parts } = createPill(link, key);
  const decorations = [parts.dot, parts.status, parts.title, parts.side];
  const render = (): void =>
    renderPill(parts, getTicketSummary(key), options.unavailableLabel());
  const unwatch = watchTicketSummary(key);
  const unsubscribe = subscribeTicketSummaries(render);

  link.addEventListener("click", (event) => {
    event.preventDefault();

    // Selecting text inside the pill, or extending a selection, stays editing.
    const isSelecting =
      event.shiftKey ||
      link.ownerDocument.getSelection()?.isCollapsed === false;

    if (!isSelecting && getTicketSummary(key).status !== "hidden") {
      options.open(path, event.ctrlKey || event.metaKey);
    }
  });
  render();

  return {
    contentDOM,
    destroy: () => {
      unsubscribe();
      unwatch();
    },
    dom: link,
    // Pages writes status, title and person itself; ProseMirror reads only
    // the link text.
    ignoreMutation: (mutation: ViewMutationRecord) =>
      mutation.type !== "selection" &&
      ((mutation.type === "attributes" && mutation.target === link) ||
        decorations.some((part) => part.contains(mutation.target))),
  };
}

/** The ticket path of the link at the caret, if the caret is in one. */
function readCaretTicket(state: EditorState): string | null {
  const { $from, empty } = state.selection;
  const marks = empty
    ? [...($from.nodeAfter?.marks ?? []), ...($from.nodeBefore?.marks ?? [])]
    : [];
  const link = marks.find((mark) => mark.type.name === EDITOR_MARK.link);

  return link ? readLinkPath(link) : null;
}

function handleOpenKey(
  view: EditorView,
  event: KeyboardEvent,
  options: TicketLinkOptions,
): boolean {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) {
    return false;
  }

  const path = options.isEnabled() ? readCaretTicket(view.state) : null;
  const key = path === null ? null : readTicketKey(path);

  if (path === null || key === null) {
    return false;
  }

  event.preventDefault();

  if (getTicketSummary(key).status !== "hidden") {
    options.open(path, event.shiftKey);
  }

  return true;
}

/**
 * Shows ticket links (`/tasks/<key>`) as pills with status dot, key and
 * status, and a paragraph that holds nothing but a ticket link as a card
 * with title, status and person. Mod+Enter opens the ticket at the caret.
 * @remarks
 * Only the view changes: the document keeps the link mark, so the markdown
 * stays `[KEY](/tasks/KEY)`.
 */
export const TicketLinks = Extension.create<TicketLinkOptions>({
  name: "ticketLinks",
  // Ahead of the hard break, which also listens to Mod+Enter.
  priority: 1000,

  addOptions() {
    return {
      isEnabled: () => false,
      open: () => undefined,
      unavailableLabel: () => "",
    };
  },

  addProseMirrorPlugins() {
    const { options } = this;

    return [
      new Plugin<DecorationSet>({
        key: TICKET_LINKS_KEY,
        props: {
          decorations: (state) =>
            options.isEnabled() ? TICKET_LINKS_KEY.getState(state) : null,
          handleKeyDown: (view, event) => handleOpenKey(view, event, options),
          markViews: {
            [EDITOR_MARK.link]: (mark, view, inline) =>
              createLinkView(mark, inline, options),
          },
        },
        state: {
          apply: (transaction, decorations) =>
            transaction.docChanged
              ? findBlockDecorations(transaction.doc)
              : decorations,
          init: (_, state) => findBlockDecorations(state.doc),
        },
      }),
    ];
  },
});
