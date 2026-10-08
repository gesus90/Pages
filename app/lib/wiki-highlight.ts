/** The characters of a text root with the place of each one in the DOM. */
interface TextIndex {
  readonly text: string;
  readonly points: readonly { readonly node: Text; readonly offset: number }[];
}

/** A passage of the text with what surrounds it. */
export interface QuoteReference {
  readonly quote: string;
  readonly prefix: string | null;
  readonly suffix: string | null;
}

/** Longest passage a comment can refer to, and longest surrounding piece. */
const QUOTE_LENGTH = 500;
const CONTEXT_LENGTH = 40;
const BLOCK_SELECTOR =
  "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,pre,summary,div";

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Lays the visible text of an element out as one string.
 *
 * @param root - The element that holds the rendered page.
 * @returns The text with every run of whitespace and every block boundary
 * reduced to one blank, and for each character the text node and offset it
 * comes from.
 */
export function indexText(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const points: { node: Text; offset: number }[] = [];
  let text = "";
  let previousBlock: Element | null | undefined;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const block = textNode.parentElement?.closest(BLOCK_SELECTOR);

    if (
      previousBlock !== undefined &&
      block !== previousBlock &&
      !text.endsWith(" ")
    ) {
      text += " ";
      points.push({ node: textNode, offset: 0 });
    }

    previousBlock = block;

    for (const [offset, character] of [...textNode.data].entries()) {
      const isBlank = /\s/.test(character);

      if (!isBlank || (!text.endsWith(" ") && text !== "")) {
        text += isBlank ? " " : character;
        points.push({ node: textNode, offset });
      }
    }
  }

  return { points, text };
}

function commonSuffixLength(left: string, right: string): number {
  let length = 0;

  while (
    length < left.length &&
    length < right.length &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }

  return length;
}

function commonPrefixLength(left: string, right: string): number {
  let length = 0;

  while (
    length < left.length &&
    length < right.length &&
    left[length] === right[length]
  ) {
    length += 1;
  }

  return length;
}

/**
 * Finds a quoted passage in the rendered page.
 *
 * @param root - The element that holds the rendered page.
 * @param reference - Quote with its surroundings.
 * @returns A range around the passage, or `null` when it is gone. If the
 * passage occurs more than once, the occurrence whose surroundings match best
 * wins.
 */
export function findQuoteRange(
  root: HTMLElement,
  reference: QuoteReference,
): Range | null {
  const { points, text } = indexText(root);
  const needle = collapse(reference.quote);
  const prefix = collapse(reference.prefix ?? "");
  const suffix = collapse(reference.suffix ?? "");
  let best = -1;
  let bestScore = -1;

  for (
    let index = text.indexOf(needle);
    needle !== "" && index >= 0;
    index = text.indexOf(needle, index + 1)
  ) {
    const score =
      commonSuffixLength(text.slice(0, index).trimEnd(), prefix) +
      commonPrefixLength(text.slice(index + needle.length).trimStart(), suffix);

    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }

  const start = points[best];
  const end = points[best + needle.length - 1];

  if (best < 0 || !start || !end) {
    return null;
  }

  const range = document.createRange();

  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);

  return range;
}

/**
 * Reads the passage a person selected inside the rendered page.
 *
 * @param root - The element that holds the rendered page.
 * @param selection - The current selection of the window.
 * @returns The passage with the text before and after it, or `null` when the
 * selection is empty, outside the page or longer than a comment may quote.
 */
export function readSelectionQuote(
  root: HTMLElement,
  selection: Selection | null,
): QuoteReference | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);

  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }

  const quote = collapse(selection.toString());
  const { points, text } = indexText(root);
  const found = points.findIndex(
    (point) =>
      point.node === range.startContainer && point.offset >= range.startOffset,
  );
  const index =
    found >= 0 && text.startsWith(quote, found) ? found : text.indexOf(quote);

  if (quote === "" || quote.length > QUOTE_LENGTH || index < 0) {
    return null;
  }

  return {
    prefix:
      text.slice(Math.max(0, index - CONTEXT_LENGTH), index).trim() || null,
    quote,
    suffix:
      text
        .slice(index + quote.length, index + quote.length + CONTEXT_LENGTH)
        .trim() || null,
  };
}
