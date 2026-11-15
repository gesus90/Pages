import { useEffect, useRef, useState } from "react";

/** The search of a long view whose parts carry `data-block-index`. */
export interface BlockSearch {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  /** The indices of the parts that match, in order. */
  readonly matches: readonly number[];
  /** The match shown, from 0. */
  readonly current: number;
  readonly step: (direction: number) => void;
  /** The scrolling element that holds the parts. */
  readonly container: React.RefObject<HTMLDivElement | null>;
  /** Scrolls a part into view. */
  readonly reveal: (index: number) => void;
}

/**
 * Searches the parts of a document or the slides of a presentation and
 * scrolls the current match into view (PAGE-385).
 *
 * @param texts - The plain text of every part, by its index.
 */
export function useBlockSearch(texts: readonly string[]): BlockSearch {
  const [query, setQueryState] = useState("");
  const [current, setCurrent] = useState(0);
  const container = useRef<HTMLDivElement | null>(null);
  const search = query.trim().toLocaleLowerCase();
  const matches =
    search === ""
      ? []
      : texts.flatMap((text, index) =>
          text.toLocaleLowerCase().includes(search) ? [index] : [],
        );
  const target = matches[Math.min(current, matches.length - 1)];

  function reveal(index: number): void {
    const element = container.current?.querySelector(
      `[data-block-index="${String(index)}"]`,
    );
    if (element instanceof HTMLElement)
      element.scrollIntoView({ block: "center" });
  }

  useEffect(() => {
    if (target === undefined) return;
    const element = container.current?.querySelector(
      `[data-block-index="${String(target)}"]`,
    );
    if (element instanceof HTMLElement)
      element.scrollIntoView({ block: "center" });
  }, [target]);

  return {
    query,
    setQuery(next) {
      setQueryState(next);
      setCurrent(0);
    },
    matches,
    current: Math.max(0, Math.min(current, matches.length - 1)),
    step(direction) {
      if (matches.length === 0) return;
      setCurrent(
        (index) => (index + direction + matches.length) % matches.length,
      );
    },
    container,
    reveal,
  };
}
