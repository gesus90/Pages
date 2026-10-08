/** The pages and tickets a text links to. */
export interface WikiLinkTargets {
  readonly pageIds: readonly string[];
  readonly ticketKeys: readonly string[];
}

const PAGE_ADDRESS = /\/wiki\/([\w-]+)/g;
const TICKET_ADDRESS =
  /\/(?:aufgaben|tasks)\/([A-Za-z][A-Za-z0-9]*-\d+)(?!\w)/g;
const RESERVED_PAGE_PATHS = new Set(["attachments", "trash", "search"]);

/**
 * Reads the pages and tickets a markdown text links to.
 *
 * @param content - Markdown text of a page.
 * @returns Page identifiers and ticket keys, each once, in order of
 * appearance. Pure addresses count as well as markdown links.
 *
 * @remarks
 * Only the path matters, so a link works the same with and without the
 * address of the server in front of it.
 */
export function extractWikiLinks(content: string): WikiLinkTargets {
  const pageIds = new Set<string>();
  const ticketKeys = new Set<string>();

  for (const [, id = ""] of content.matchAll(PAGE_ADDRESS)) {
    if (!RESERVED_PAGE_PATHS.has(id)) {
      pageIds.add(id);
    }
  }

  for (const [, key = ""] of content.matchAll(TICKET_ADDRESS)) {
    ticketKeys.add(key.toUpperCase());
  }

  return { pageIds: [...pageIds], ticketKeys: [...ticketKeys] };
}

/**
 * Tells whether a text links to the page with the given identifier.
 *
 * @param text - A description of a ticket or project.
 * @param pageId - Page identifier.
 * @returns Whether `/wiki/<pageId>` occurs and ends at a word boundary.
 */
export function mentionsWikiPage(text: string, pageId: string): boolean {
  return extractWikiLinks(text).pageIds.includes(pageId);
}
