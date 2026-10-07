const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const WIKI_PATH_PATTERN = /^\/wiki(?:[/?#]|$)/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const PARSE_BASE = "http://pages.invalid";

/**
 * Neutralises unsafe link targets of rendered markdown.
 *
 * @param url - Link target as written in the markdown.
 * @returns The target when it is http, https, mailto or a relative path,
 * otherwise an empty string.
 */
export function transformMarkdownUrl(url: string): string {
  const trimmed = url.trim();

  if (trimmed.startsWith("//")) {
    return "";
  }

  const parsed = parseUrl(trimmed);

  if (!parsed) {
    return "";
  }

  if (parsed.base) {
    return trimmed;
  }

  return ALLOWED_PROTOCOLS.has(parsed.url.protocol) ? trimmed : "";
}

/**
 * Tells whether an in-app path belongs to the Wiki.
 *
 * @param path - Path as returned by `toOwnPath`.
 * @returns `true` for `/wiki` and everything below it.
 *
 * @remarks
 * A link never grants access: the Wiki route checks visibility itself.
 */
export function isWikiPath(path: string): boolean {
  return WIKI_PATH_PATTERN.test(path);
}

interface ParsedUrl {
  readonly url: URL;
  readonly base: boolean;
}

function parseUrl(text: string): ParsedUrl | undefined {
  try {
    const url = new URL(text, PARSE_BASE);

    return { url, base: url.origin === PARSE_BASE };
  } catch {
    return undefined;
  }
}

/**
 * Returns the in-app path of a relative or same-origin target.
 *
 * @param href - Sanitised link target.
 * @param ownOrigin - Origin of this application, when known.
 * @returns The path, or `undefined` for a foreign target.
 */
export function toOwnPath(
  href: string,
  ownOrigin?: string,
): string | undefined {
  if (!SCHEME_PATTERN.test(href)) {
    return href;
  }

  if (!ownOrigin || !href.startsWith(`${ownOrigin}/`)) {
    return undefined;
  }

  return href.slice(ownOrigin.length);
}
