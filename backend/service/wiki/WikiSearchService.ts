import { WikiPageReader } from "./WikiPageReader";
import { mentionsWikiPage } from "./WikiLinks";
import { createSnippet, parseSearchText } from "./WikiSearchQuery";
import { toPlainText } from "./WikiPlainText";
import { normalizeDate } from "./WikiValidation";

import type {
  WikiRepository,
  WikiSearchArea,
  WikiSearchSort,
} from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type {
  WikiBacklinks,
  WikiReference,
  WikiSearchResponse,
} from "@/definition/Wiki";
import type { WikiAccess } from "./WikiAccess";

/** What a person typed into the search dialog. */
export interface WikiSearchInput {
  readonly text: string;
  readonly titleOnly: boolean;
  /** `instance`, `private` or `project:<id>`; `null` for everywhere. */
  readonly location: string | null;
  readonly underPageId: string | null;
  readonly creatorId: string | null;
  readonly editedFrom: string | null;
  readonly editedTo: string | null;
  readonly sort: string | null;
}

const SEARCH_LIMIT = 30;
const REFERENCE_LIMIT = 6;
const SORTS: readonly WikiSearchSort[] = ["relevance", "edited", "created"];

function parseArea(location: string | null): WikiSearchArea | null {
  if (location === "instance" || location === "private") {
    return { scope: location };
  }

  return location?.startsWith("project:")
    ? { projectId: location.slice("project:".length), scope: "project" }
    : null;
}

/** Searches pages, resolves references and finds where a page is mentioned. */
export class WikiSearchService {
  private readonly repository: WikiRepository;
  private readonly access: WikiAccess;

  /**
   * Creates the service.
   *
   * @param repository - Wiki persistence.
   * @param access - Resolves who is acting.
   */
  public constructor(repository: WikiRepository, access: WikiAccess) {
    this.repository = repository;
    this.access = access;
  }

  /**
   * Searches the titles and texts of the pages the person may see.
   *
   * @param actor - The signed-in user.
   * @param input - Search text and filters.
   * @returns The best hits with a passage each, and the number of hits.
   * Without words and without filters nothing is searched.
   * @throws {WikiValidationError} For an invalid date.
   *
   * @remarks
   * The visibility filter runs inside the query before matching, ranking and
   * counting; passages are cut from pages that are already allowed (T4.8.4).
   */
  public async search(
    actor: User,
    input: WikiSearchInput,
  ): Promise<WikiSearchResponse> {
    const viewer = await this.access.resolve(actor);
    const { phrases, terms } = parseSearchText(input.text);
    const filters = {
      area: parseArea(input.location),
      creatorId: input.creatorId,
      editedFrom: normalizeDate(input.editedFrom),
      editedTo: normalizeDate(input.editedTo),
      limit: SEARCH_LIMIT,
      phrases,
      sort: SORTS.find((sort) => sort === input.sort) ?? "relevance",
      terms,
      titleOnly: input.titleOnly,
      underPageId: input.underPageId,
    };
    const hasFilter =
      filters.area !== null ||
      filters.creatorId !== null ||
      filters.editedFrom !== null ||
      filters.editedTo !== null ||
      filters.underPageId !== null;

    if (terms.length + phrases.length === 0 && !hasFilter) {
      return { results: [], total: 0 };
    }

    const { hits, total } = await this.repository.search.search(
      viewer.scope,
      filters,
    );
    const needles = [...terms, ...phrases];

    return {
      results: hits.map(({ content, ...page }) => ({
        ...page,
        snippet: createSnippet(toPlainText(content), needles),
      })),
      total,
    };
  }

  /**
   * Offers pages, tickets and people to link or mention.
   *
   * @param actor - The signed-in user.
   * @param query - Text typed after `[[` or `@`.
   * @returns A few suggestions of each kind; pages and tickets only if the
   * person may see them.
   */
  public async references(
    actor: User,
    query: string,
  ): Promise<WikiReference[]> {
    const viewer = await this.access.resolve(actor);
    const [pages, tickets, people] = await Promise.all([
      this.repository.search.searchTitles(viewer.scope, query, REFERENCE_LIMIT),
      this.repository.links.searchTickets(viewer.scope, query, REFERENCE_LIMIT),
      this.repository.lookups.searchUsers(query, REFERENCE_LIMIT),
    ]);

    return [
      ...pages.map((page): WikiReference => ({ kind: "page", ...page })),
      ...tickets.map((ticket): WikiReference => ({
        kind: "ticket",
        ...ticket,
      })),
      ...people.map((person): WikiReference => ({ kind: "person", ...person })),
    ];
  }

  /**
   * Resolves the titles of pages that tickets and projects link to.
   *
   * @param actor - The signed-in user.
   * @param ids - Page identifiers read from the links.
   * @returns Title by identifier for the pages the person may see; the others
   * are left out, so a link never reveals a title.
   */
  public async linkTitles(
    actor: User,
    ids: readonly string[],
  ): Promise<Record<string, string>> {
    const viewer = await this.access.resolve(actor);
    const titles = await this.repository.pages.findTitles(viewer.scope, ids);

    return Object.fromEntries(titles.map(({ id, title }) => [id, title]));
  }

  /**
   * Finds where a page is mentioned.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @returns Pages, tickets and projects that link to the page and that the
   * person may see; the others neither appear nor are counted (T4.5.5).
   * @throws {WikiPageNotFoundError} When the person may not see the page.
   */
  public async backlinks(actor: User, id: string): Promise<WikiBacklinks> {
    const viewer = await this.access.resolve(actor);

    await new WikiPageReader(this.repository).require(viewer.scope, id);

    const needle = `/wiki/${id}`;
    const [pages, tickets, projects] = await Promise.all([
      this.repository.links.findLinkingPages(viewer.scope, id),
      this.repository.links.findTicketsMentioning(viewer.scope, needle),
      this.repository.links.findProjectsMentioning(viewer.scope, needle),
    ]);

    return {
      pages: pages.map(({ icon, id: pageId, title }) => ({
        icon,
        id: pageId,
        title,
      })),
      projects: projects
        .filter((project) => mentionsWikiPage(project.description, id))
        .map((project) => ({ id: project.id, name: project.name })),
      tickets: tickets
        .filter((ticket) => mentionsWikiPage(ticket.description, id))
        .map((ticket) => ({
          id: ticket.id,
          key: ticket.key,
          title: ticket.title,
        })),
    };
  }
}
