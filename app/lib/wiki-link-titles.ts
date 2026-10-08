const WIKI_PAGE_PATH = /^\/wiki\/([\w-]+)(?:\/[\w-]*)?(?:[?#].*)?$/;
const RESERVED_PATHS = new Set(["attachments", "trash"]);

type TitleResolver = (title: string | null) => void;

const waiting = new Map<string, TitleResolver[]>();
let isScheduled = false;

/**
 * Reads the page identifier out of the address of a wiki page.
 *
 * @param path - In-app path of a link.
 * @returns The identifier, or `null` for other paths and for the fixed
 * addresses below `/wiki`.
 */
export function readWikiPageId(path: string): string | null {
  const [, id = null] = WIKI_PAGE_PATH.exec(path) ?? [];

  return id === null || RESERVED_PATHS.has(id) ? null : id;
}

async function resolveBatch(
  ids: readonly string[],
): Promise<Record<string, string>> {
  try {
    const response = await fetch(
      `/wiki-api/link-titles?ids=${encodeURIComponent(ids.join(","))}`,
    );
    const body: unknown = await response.json();

    return isTitleBody(body) ? body.titles : {};
  } catch {
    return {};
  }
}

function isTitleBody(
  body: unknown,
): body is { titles: Record<string, string> } {
  return (
    typeof body === "object" &&
    body !== null &&
    "titles" in body &&
    typeof body.titles === "object" &&
    body.titles !== null
  );
}

async function flush(): Promise<void> {
  const batch = new Map(waiting);

  waiting.clear();
  isScheduled = false;

  const titles = await resolveBatch([...batch.keys()]);

  for (const [id, resolvers] of batch) {
    for (const resolve of resolvers) {
      resolve(titles[id] ?? null);
    }
  }
}

/**
 * Asks the server for the title of a wiki page that a link points to.
 *
 * @param id - Page identifier.
 * @returns The title when the signed-in person may see the page, otherwise
 * `null`. Requests made in the same moment share one round trip, and nothing
 * is kept afterwards, so a title never outlives the person's access.
 */
export function requestWikiLinkTitle(id: string): Promise<string | null> {
  return new Promise((resolve) => {
    waiting.set(id, [...(waiting.get(id) ?? []), resolve]);

    if (!isScheduled) {
      isScheduled = true;
      setTimeout(() => void flush(), 0);
    }
  });
}
