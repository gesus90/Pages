import { WIKI_LIMITS } from "@/definition/Wiki";

/** A heading of a page, for the table of contents and the anchors. */
export interface WikiHeading {
  readonly level: number;
  readonly text: string;
  /** Anchor identifier, unique within the page. */
  readonly id: string;
  /** Line of the heading in the markdown text, counted from 1. */
  readonly line: number;
}

const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const FENCE_PATTERN = /^\s*(```|~~~)/;

/**
 * Turns heading text into an anchor identifier.
 *
 * @param text - Plain heading text.
 * @returns Lower-case words joined by hyphens.
 */
export function slugifyHeading(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Removes the markup of a heading so that only its words remain.
 *
 * @param text - Heading text as written.
 * @returns Plain text, shortened to the heading limit.
 */
export function plainHeadingText(text: string): string {
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();

  return Array.from(plain).slice(0, WIKI_LIMITS.headingLength).join("");
}

/**
 * Reads the headings H1 to H3 of a markdown text.
 *
 * @param source - Markdown text.
 * @returns The headings in order, each with a unique anchor identifier.
 *
 * @remarks
 * Lines inside fenced code blocks are no headings. The same function serves
 * the table of contents and the heading identifiers of the renderer, so
 * links to an anchor and the rendered page agree.
 */
export function extractHeadings(source: string): WikiHeading[] {
  const headings: WikiHeading[] = [];
  const used = new Map<string, number>();
  let isInsideFence = false;

  for (const [index, line] of source.split("\n").entries()) {
    if (FENCE_PATTERN.test(line)) {
      isInsideFence = !isInsideFence;

      continue;
    }

    const match = isInsideFence ? null : HEADING_PATTERN.exec(line);

    if (match) {
      const [, hashes = "", rawText = ""] = match;
      const text = plainHeadingText(rawText);
      const base = slugifyHeading(text) || "section";
      const count = used.get(base) ?? 0;

      used.set(base, count + 1);
      headings.push({
        id: count === 0 ? base : `${base}-${count}`,
        level: hashes.length,
        line: index + 1,
        text,
      });
    }
  }

  return headings;
}
