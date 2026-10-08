/** A search text split into words and quoted phrases. */
export interface ParsedSearchText {
  /** Single words; every one must occur. */
  readonly terms: readonly string[];
  /** Quoted phrases; each must occur exactly as written. */
  readonly phrases: readonly string[];
}

const TOKEN_PATTERN = /"([^"]+)"|(\S+)/g;

/**
 * Splits a search text into words and quoted phrases.
 *
 * @param text - What the person typed.
 * @returns Words and phrases in order of appearance; quotes that are never
 * closed count as part of a word.
 */
export function parseSearchText(text: string): ParsedSearchText {
  const terms: string[] = [];
  const phrases: string[] = [];

  for (const [, phrase, word] of text.matchAll(TOKEN_PATTERN)) {
    if (phrase !== undefined) {
      phrases.push(phrase.trim());
    } else if (word !== undefined && word.replaceAll('"', "") !== "") {
      terms.push(word.replaceAll('"', ""));
    }
  }

  return { phrases: phrases.filter((phrase) => phrase !== ""), terms };
}

/**
 * Cuts a short passage around the first hit out of a page text.
 *
 * @param content - Markdown text of a page the viewer may see.
 * @param needles - Words and phrases that were searched.
 * @param radius - Characters kept on each side of the hit.
 * @returns The passage on one line, or the start of the text when the text
 * holds no needle (the title matched).
 */
export function createSnippet(
  content: string,
  needles: readonly string[],
  radius = 70,
): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const positions = needles
    .map((needle) => lower.indexOf(needle.toLowerCase()))
    .filter((position) => position >= 0);
  const first = positions.length === 0 ? 0 : Math.min(...positions);
  const start = Math.max(0, first - radius);
  const end = Math.min(flat.length, first + radius * 2);
  const passage = flat.slice(start, end);

  return `${start > 0 ? "…" : ""}${passage}${end < flat.length ? "…" : ""}`;
}
