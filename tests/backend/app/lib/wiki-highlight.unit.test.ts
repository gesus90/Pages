// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  findQuoteRange,
  indexText,
  readSelectionQuote,
} from "@/app/lib/wiki-highlight";

/** A rendered wiki page; the markup decides which breaks count as blocks. */
function page(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

/** Selects the text between two offsets of two text nodes. */
function select(
  start: { node: Node; offset: number },
  end: { node: Node; offset: number },
): Selection {
  const selection = window.getSelection();
  if (!selection) throw new Error("jsdom has no selection.");
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function textNode(root: HTMLElement, selector: string): Text {
  const node = root.querySelector(selector)?.firstChild;
  if (!(node instanceof Text)) throw new Error(`No text in ${selector}.`);
  return node;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("indexing the text of a page", () => {
  it("collapses whitespace and separates blocks by one space", () => {
    const root = page(
      "<p>Hello   <b>big</b>\n world</p><p>Next</p><ul><li>One</li><li>Two</li></ul>",
    );

    const { text, points } = indexText(root);

    expect(text).toBe("Hello big world Next One Two");
    expect(points).toHaveLength(text.length);
  });

  it("starts without leading whitespace and does not double a space at a block border", () => {
    const root = page("<p>  lead </p><p> trail</p>");

    expect(indexText(root).text).toBe("lead trail");
  });

  it("indexes an empty page as empty text", () => {
    expect(indexText(page("")).text).toBe("");
  });
});

describe("finding a quote", () => {
  const html =
    "<p>Alpha beta gamma.</p><p>Delta beta epsilon.</p><p>Zeta beta eta.</p>";

  it("returns the range of a unique quote", () => {
    const root = page("<p>The quick <em>brown</em> fox</p>");

    const range = findQuoteRange(root, {
      quote: "quick brown fox",
      prefix: null,
      suffix: null,
    });

    expect(range?.toString()).toBe("quick brown fox");
  });

  it("ignores differences in whitespace between page and quote", () => {
    const root = page("<p>one two</p><p>three</p>");

    const range = findQuoteRange(root, {
      quote: "two\n   three",
      prefix: null,
      suffix: null,
    });

    // The range covers the text nodes; the block separator is not part of the DOM.
    expect(range?.startContainer.textContent).toBe("one two");
    expect(range?.endContainer.textContent).toBe("three");
    expect(range?.toString()).toBe("twothree");
  });

  it("picks the occurrence whose context matches best", () => {
    const root = page(html);

    const byPrefix = findQuoteRange(root, {
      quote: "beta",
      prefix: "Delta",
      suffix: null,
    });
    const bySuffix = findQuoteRange(root, {
      quote: "beta",
      prefix: null,
      suffix: "eta.",
    });
    const first = findQuoteRange(root, {
      quote: "beta",
      prefix: null,
      suffix: null,
    });

    expect(byPrefix?.startContainer.textContent).toBe("Delta beta epsilon.");
    expect(bySuffix?.startContainer.textContent).toBe("Zeta beta eta.");
    expect(first?.startContainer.textContent).toBe("Alpha beta gamma.");
  });

  it("finds nothing for an unknown or an empty quote", () => {
    const root = page(html);

    expect(
      findQuoteRange(root, { quote: "omega", prefix: null, suffix: null }),
    ).toBeNull();
    expect(
      findQuoteRange(root, { quote: "   ", prefix: null, suffix: null }),
    ).toBeNull();
  });
});

describe("reading a selected quote", () => {
  it("returns nothing without a selection, a collapsed one or one outside the page", () => {
    const root = page("<p>Inside the page</p>");
    const outside = document.createElement("p");
    outside.textContent = "Outside";
    document.body.append(outside);

    expect(readSelectionQuote(root, null)).toBeNull();
    expect(readSelectionQuote(root, window.getSelection())).toBeNull();
    const collapsed = select(
      { node: textNode(root, "p"), offset: 3 },
      { node: textNode(root, "p"), offset: 3 },
    );
    expect(readSelectionQuote(root, collapsed)).toBeNull();
    const elsewhere = select(
      { node: outside.firstChild as Node, offset: 0 },
      { node: outside.firstChild as Node, offset: 4 },
    );
    expect(readSelectionQuote(root, elsewhere)).toBeNull();
  });

  it("returns the quote with up to forty characters of context on each side", () => {
    const root = page(
      "<p>The first sentence is quite long, but this part is the quote we want, and what follows is the rest of the page text.</p>",
    );
    const node = textNode(root, "p");
    const start = node.data.indexOf("the quote");
    const selection = select(
      { node, offset: start },
      { node, offset: start + "the quote".length },
    );

    const reference = readSelectionQuote(root, selection);

    expect(reference?.quote).toBe("the quote");
    expect(reference?.prefix).toBe("entence is quite long, but this part is");
    expect(reference?.suffix).toBe("we want, and what follows is the rest o");
    expect(reference?.prefix?.length).toBeLessThanOrEqual(40);
    expect(reference?.suffix?.length).toBeLessThanOrEqual(40);
  });

  it("uses no context at the start and the end of the page", () => {
    const root = page("<p>Whole</p>");
    const node = textNode(root, "p");

    const reference = readSelectionQuote(
      root,
      select({ node, offset: 0 }, { node, offset: 5 }),
    );

    expect(reference).toEqual({ quote: "Whole", prefix: null, suffix: null });
  });

  it("picks the occurrence that is actually selected", () => {
    const root = page("<p>again</p><p>and again</p>");
    const node = textNode(root, "p:nth-child(2)");

    const reference = readSelectionQuote(
      root,
      select({ node, offset: 4 }, { node, offset: 9 }),
    );

    expect(reference).toEqual({
      quote: "again",
      prefix: "again and",
      suffix: null,
    });
  });

  it("falls back to the first occurrence when the start cannot be located", () => {
    const root = page("<p>alpha beta</p>");
    const node = textNode(root, "p");
    const selection = select({ node, offset: 6 }, { node, offset: 10 });
    // The selection starts on the element, not on a text node of the index.
    selection.getRangeAt(0).setStart(root, 0);

    const reference = readSelectionQuote(root, selection);

    expect(reference?.quote).toBe(
      selection.toString().replace(/\s+/gu, " ").trim(),
    );
  });

  it("refuses a blank selection and one that is longer than five hundred characters", () => {
    const blank = page("<p>one     two</p>");
    const blankNode = textNode(blank, "p");
    const blankSelection = select(
      { node: blankNode, offset: 3 },
      { node: blankNode, offset: 8 },
    );
    const long = page(`<p>${"x".repeat(501)}</p>`);
    const longNode = textNode(long, "p");
    const longSelection = select(
      { node: longNode, offset: 0 },
      { node: longNode, offset: 501 },
    );

    expect(readSelectionQuote(blank, blankSelection)).toBeNull();
    expect(readSelectionQuote(long, longSelection)).toBeNull();
  });
});
