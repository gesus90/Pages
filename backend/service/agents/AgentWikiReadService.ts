import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { pageAgentEntries } from "./AgentCursor";
import { indexText, readTextRange } from "./AgentTextRange";

import type { AgentListWindow } from "./AgentCursor";
import type {
  AgentTextRangeRequest,
  AgentWikiPageRange,
} from "@/definition/AgentTextRange";
import type { WikiAnchorRepository } from "@/backend/database/repositories/wiki/WikiAnchorRepository";
import type { WikiReadService } from "@/backend/service/wiki/WikiReadService";
import type { WikiSearchService } from "@/backend/service/wiki/WikiSearchService";
import type {
  AgentWikiPage,
  AgentWikiSearch,
  AgentWikiTree,
} from "@/definition/PagesAgentOperations";
import type { User } from "@/definition/User";

/** Projects existing visibility-filtered wiki reads into bounded agent-only results. */
export class AgentWikiReadService {
  private readonly reads: Pick<
    WikiReadService,
    "readWithoutVisit" | "visibleNodes"
  >;
  private readonly searches: Pick<WikiSearchService, "search">;
  private readonly anchors: Pick<WikiAnchorRepository, "findAnchors"> | null;

  /**
   * Creates the read service.
   *
   * @param reads - Visibility-filtered page reads.
   * @param searches - Visibility-filtered search.
   * @param anchors - Reads what a page is tied to; without it pages report no anchors.
   */
  public constructor(
    reads: Pick<WikiReadService, "readWithoutVisit" | "visibleNodes">,
    searches: Pick<WikiSearchService, "search">,
    anchors: Pick<WikiAnchorRepository, "findAnchors"> | null = null,
  ) {
    this.reads = reads;
    this.searches = searches;
    this.anchors = anchors;
  }

  /** Reads complete Markdown, revision, icon and cover without recording a visit or revealing private placeholders. */
  public async read(actor: User, pageId: string): Promise<AgentWikiPage> {
    try {
      const {
        id,
        title,
        content,
        revision,
        parentId,
        scope,
        projectId,
        icon,
        cover,
      } = await this.reads.readWithoutVisit(actor, pageId);
      if (
        Buffer.byteLength(content, "utf8") > PAGES_AGENT_LIMITS.wikiContentBytes
      )
        throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
          constraint: "wikiContentBytes",
          limit: PAGES_AGENT_LIMITS.wikiContentBytes,
        });
      return {
        id,
        title,
        content,
        revision,
        parentId,
        scope,
        projectId,
        icon,
        cover,
        anchors: (await this.anchors?.findAnchors(id)) ?? [],
      };
    } catch (error: unknown) {
      if (error instanceof WikiPageNotFoundError)
        throw new AgentOperationError("NOT_FOUND");
      throw error;
    }
  }

  /**
   * Reads one passage of the Markdown of a visible page without recording a visit.
   *
   * @param actor - The account the read runs for.
   * @param pageId - The page identifier.
   * @param range - Start, optional end and the character budget.
   * @returns The passage with its absolute positions, the revision and the size of the page; never the whole text.
   * @throws {AgentOperationError} `NOT_FOUND`, `INVALID_REQUEST` for an unusable position or `PAYLOAD_TOO_LARGE` for a range over the budget.
   */
  public async readRange(
    actor: User,
    pageId: string,
    range: AgentTextRangeRequest,
  ): Promise<AgentWikiPageRange> {
    try {
      const { id, content, revision } = await this.reads.readWithoutVisit(
        actor,
        pageId,
      );
      return {
        pageId: id,
        link: `/wiki/${id}`,
        revision,
        ...readTextRange(indexText(content), range),
      };
    } catch (error: unknown) {
      if (error instanceof WikiPageNotFoundError)
        throw new AgentOperationError("NOT_FOUND");
      throw error;
    }
  }

  /** Pages visible nodes, preserving references to visible parents on other result pages. */
  public async tree(
    actor: User,
    projectId?: string,
    paging?: AgentListWindow,
  ): Promise<AgentWikiTree> {
    const all = (await this.reads.visibleNodes(actor)).filter(
      (node) => projectId === undefined || node.projectId === projectId,
    );
    const page = pageAgentEntries(
      all,
      paging ?? {
        context: JSON.stringify([actor.id, "wiki.tree.read", projectId]),
      },
    );
    const window = page.entries;
    const ids = new Set(all.map((node) => node.id));
    return {
      nodes: window.map(({ id, title, parentId }) => ({
        id,
        title,
        parentId: parentId !== null && ids.has(parentId) ? parentId : null,
      })),
      total: page.total,
      nextCursor: page.nextCursor,
      truncated: page.nextCursor !== null,
    };
  }

  /** Pages visible hits with 200 Unicode characters per snippet; totals share their policy. */
  public async search(
    actor: User,
    text: string,
    projectId?: string,
    paging?: AgentListWindow,
  ): Promise<AgentWikiSearch> {
    const found = await this.searches.search(
      actor,
      {
        text,
        titleOnly: false,
        location: projectId === undefined ? null : `project:${projectId}`,
        underPageId: null,
        creatorId: null,
        editedFrom: null,
        editedTo: null,
        sort: "relevance",
      },
      Number.MAX_SAFE_INTEGER,
    );
    const paged = pageAgentEntries(
      found.results,
      paging ?? {
        limit: PAGES_AGENT_LIMITS.searchResults,
        context: JSON.stringify([actor.id, "wiki.search", text, projectId]),
      },
    );
    const results = paged.entries.map(({ id, title, snippet }) => ({
      id,
      title,
      snippet: Array.from(snippet)
        .slice(0, PAGES_AGENT_LIMITS.snippetCharacters)
        .join(""),
    }));
    return {
      results,
      total: found.total,
      nextCursor: paged.nextCursor,
      truncated: paged.nextCursor !== null,
    };
  }
}
