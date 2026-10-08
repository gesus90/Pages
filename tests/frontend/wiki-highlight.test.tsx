// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCommentHighlights } from "@/app/components/wiki/use-comment-highlights";
import { useWikiSelection } from "@/app/components/wiki/use-wiki-selection";
import {
  findQuoteRange,
  indexText,
  readSelectionQuote,
} from "@/app/lib/wiki-highlight";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");

  root.innerHTML = html;
  document.body.append(root);

  return root;
}

function select(
  start: Node,
  startOffset: number,
  end: Node,
  endOffset: number,
): Selection {
  const selection = window.getSelection();

  if (!selection) {
    throw new Error("No selection API");
  }

  selection.setBaseAndExtent(start, startOffset, end, endOffset);

  return selection;
}

describe("indexText", () => {
  it("lays blocks and whitespace out as single blanks", () => {
    const root = mount(
      "<p>Hello <strong>big</strong>\n  world</p><p>  Second   para</p>",
    );

    expect(indexText(root).text).toBe("Hello big world Second para");
    expect(indexText(root).points).toHaveLength(
      "Hello big world Second para".length,
    );
  });

  it("does not start with a blank", () => {
    expect(indexText(mount("<p>  lead</p>")).text).toBe("lead");
  });
});

describe("findQuoteRange", () => {
  it("finds a passage across inline markup and block boundaries", () => {
    const root = mount(
      "<p>Hello <strong>big</strong> world</p><p>Second para</p>",
    );

    expect(
      findQuoteRange(root, {
        prefix: null,
        quote: "big world",
        suffix: null,
      })?.toString(),
    ).toBe("big world");
    expect(
      findQuoteRange(root, {
        prefix: null,
        quote: "world Second",
        suffix: null,
      })?.toString(),
    ).toContain("world");
  });

  it("picks the occurrence whose surroundings match", () => {
    const root = mount("<p>one cat two</p><p>three cat four</p>");
    const second = findQuoteRange(root, {
      prefix: "three",
      quote: "cat",
      suffix: "four",
    });
    const first = findQuoteRange(root, {
      prefix: null,
      quote: "cat",
      suffix: null,
    });

    expect(second?.startContainer.textContent).toBe("three cat four");
    expect(first?.startContainer.textContent).toBe("one cat two");
  });

  it("returns nothing for a passage that is gone or empty", () => {
    const root = mount("<p>text</p>");

    expect(
      findQuoteRange(root, { prefix: null, quote: "missing", suffix: null }),
    ).toBeNull();
    expect(
      findQuoteRange(root, { prefix: null, quote: "  ", suffix: null }),
    ).toBeNull();
  });
});

describe("readSelectionQuote", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("reads the selected passage with its surroundings", () => {
    const root = mount("<p>before the chosen words after</p>");
    const text = root.querySelector("p")?.firstChild as Text;
    const selection = select(text, 11, text, 22);

    expect(readSelectionQuote(root, selection)).toEqual({
      prefix: "before the",
      quote: "chosen word",
      suffix: "s after",
    });
  });

  it("leaves the surroundings out at the edges of the text", () => {
    const root = mount("<p>only</p>");
    const text = root.querySelector("p")?.firstChild as Text;

    expect(readSelectionQuote(root, select(text, 0, text, 4))).toEqual({
      prefix: null,
      quote: "only",
      suffix: null,
    });
  });

  it("falls back to the first occurrence when the selection starts at an element", () => {
    const root = mount("<p>twice twice</p>");
    const paragraph = root.querySelector("p") as HTMLElement;

    expect(
      readSelectionQuote(root, select(paragraph, 0, paragraph, 1))?.quote,
    ).toBe("twice twice");
  });

  it("ignores empty, collapsed, foreign and oversized selections", () => {
    const root = mount("<p>inside</p>");
    const outside = mount("<p>outside</p>");
    const text = root.querySelector("p")?.firstChild as Text;
    const foreign = outside.querySelector("p")?.firstChild as Text;
    const big = mount(`<p>${"word ".repeat(200)}</p>`);
    const bigText = big.querySelector("p")?.firstChild as Text;

    expect(readSelectionQuote(root, null)).toBeNull();
    expect(readSelectionQuote(root, window.getSelection())).toBeNull();
    expect(readSelectionQuote(root, select(text, 2, text, 2))).toBeNull();
    expect(readSelectionQuote(root, select(foreign, 0, foreign, 3))).toBeNull();
    expect(
      readSelectionQuote(big, select(bigText, 0, bigText, 900)),
    ).toBeNull();
    expect(readSelectionQuote(root, select(text, 0, text, 1))?.quote).toBe("i");
  });

  it("ignores a selection of blanks only", () => {
    const root = mount("<p>a   b</p>");
    const text = root.querySelector("p")?.firstChild as Text;

    expect(
      readSelectionQuote(root, select(text, 1, text, 4))?.quote ?? "",
    ).toBe("");
  });
});

describe("useWikiSelection", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
  });

  function Probe({ rooted }: { readonly rooted: boolean }): React.ReactElement {
    const [root, setRoot] = useStateRef();
    const selection = useWikiSelection(rooted ? root : null);

    return (
      <div>
        <p ref={setRoot} data-testid="text">
          some selectable text
        </p>
        <output>{selection?.quote ?? "none"}</output>
      </div>
    );
  }

  it("follows the selection inside the page and forgets it afterwards", () => {
    const { rerender } = render(<Probe rooted />);
    const text = screen.getByTestId("text").firstChild as Text;

    act(() => {
      select(text, 5, text, 15);
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(screen.getByRole("status")).toHaveTextContent("selectable");

    rerender(<Probe rooted={false} />);

    expect(screen.getByRole("status")).toHaveTextContent("none");
  });

  it("reports nothing while there is no page", () => {
    render(<Probe rooted={false} />);

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(screen.getByRole("status")).toHaveTextContent("none");
  });
});

import { useState } from "react";

function useStateRef(): [
  HTMLElement | null,
  (node: HTMLElement | null) => void,
] {
  return useState<HTMLElement | null>(null);
}

describe("useCommentHighlights", () => {
  const original = {
    css: Object.getOwnPropertyDescriptor(globalThis, "CSS"),
    highlight: Object.getOwnPropertyDescriptor(globalThis, "Highlight"),
  };

  function Probe({ quote }: { readonly quote: string }): React.ReactElement {
    const [root, setRoot] = useStateRef();

    useCommentHighlights(root, [{ prefix: null, quote, suffix: null }]);

    return <p ref={setRoot}>passage that is commented</p>;
  }

  beforeEach(() => {
    class FakeHighlight {
      public readonly ranges: Range[];

      public constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }

    vi.stubGlobal("Highlight", FakeHighlight);
    vi.stubGlobal("CSS", { highlights: new Map() });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("paints the commented passages and removes them again", () => {
    const { unmount } = render(<Probe quote="that is" />);
    const highlights = (
      CSS as unknown as { highlights: Map<string, { ranges: Range[] }> }
    ).highlights;

    expect(highlights.get("wiki-comment")?.ranges.map(String)).toEqual([
      "that is",
    ]);

    unmount();

    expect(highlights.has("wiki-comment")).toBe(false);
  });

  it("skips passages that are gone", () => {
    render(<Probe quote="not there" />);

    const highlights = (
      CSS as unknown as { highlights: Map<string, { ranges: Range[] }> }
    ).highlights;

    expect(highlights.get("wiki-comment")?.ranges).toEqual([]);
  });

  it("does nothing in browsers without the highlight API", () => {
    vi.stubGlobal("CSS", {});

    expect(() => render(<Probe quote="that" />)).not.toThrow();

    vi.stubGlobal("CSS", undefined);

    expect(() => render(<Probe quote="that" />)).not.toThrow();
    void original;
  });
});
