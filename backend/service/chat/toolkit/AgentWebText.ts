/** The named entities a page uses most; others stay as written. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  euro: "€",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/** Replaces character references with their characters. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/giu,
    (match, name: string) => {
      if (name.startsWith("#x") || name.startsWith("#X"))
        return safeCodePoint(Number.parseInt(name.slice(2), 16), match);
      if (name.startsWith("#"))
        return safeCodePoint(Number.parseInt(name.slice(1), 10), match);
      return ENTITIES[name] ?? match;
    },
  );
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

/** The title of an HTML page, or `null` without one. */
export function htmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  const title = match
    ? decodeEntities(match[1]).replace(/\s+/gu, " ").trim()
    : "";
  return title === "" ? null : title;
}

/**
 * Turns an HTML page into readable text (PAGE-390): scripts, styles and
 * markup go, blocks become lines, links keep their address in brackets.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(
      /<(script|style|noscript|template|svg|head)[^>]*>[\s\S]*?<\/\1>/giu,
      "",
    )
    .replace(
      /<a\s[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/giu,
      (_, href: string, label: string) => `${label} [${href}]`,
    )
    .replace(/<(br|hr)\s*\/?>/giu, "\n")
    .replace(/<li[^>]*>/giu, "\n- ")
    .replace(
      /<\/?(p|div|section|article|header|footer|main|nav|aside|h[1-6]|ul|ol|table|tr|blockquote|pre|form)[^>]*>/giu,
      "\n",
    )
    .replace(/<(td|th)[^>]*>/giu, " | ")
    .replace(/<[^>]+>/gu, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/gu, " ").trim())
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trim();
}

/** One hit of a web search. */
export interface AgentWebSearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/** The real address behind a link of the search page. */
function resultAddress(href: string): string | null {
  const decoded = decodeEntities(href);
  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    const address = target ?? url.toString();
    return /^https?:\/\//u.test(address) ? address : null;
  } catch {
    return null;
  }
}

/**
 * Reads the hits of the HTML result page of DuckDuckGo.
 *
 * @param html - The result page.
 * @param limit - The most hits to return.
 */
export function parseSearchResults(
  html: string,
  limit: number,
): AgentWebSearchHit[] {
  const hits: AgentWebSearchHit[] = [];
  const blocks = html.split(/class="result(?:\s|__body|")/u).slice(1);
  for (const block of blocks) {
    if (hits.length >= limit) break;
    const link =
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/u.exec(
        block,
      ) ??
      /<a[^>]*href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/u.exec(
        block,
      );
    if (!link) continue;
    const url = resultAddress(link[1]);
    if (url === null || hits.some((hit) => hit.url === url)) continue;
    const snippet =
      /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/u.exec(block);
    hits.push({
      title: htmlToText(link[2]),
      url,
      snippet: snippet ? htmlToText(snippet[1]) : "",
    });
  }
  return hits;
}
