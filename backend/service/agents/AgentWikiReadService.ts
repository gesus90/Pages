import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

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

  public constructor(
    reads: Pick<WikiReadService, "readWithoutVisit" | "visibleNodes">,
    searches: Pick<WikiSearchService, "search">,
  ) {
    this.reads = reads;
    this.searches = searches;
  }

  /** Reads complete Markdown and revision without recording a visit or revealing private placeholders. */
  public async read(actor: User, pageId: string): Promise<AgentWikiPage> {
    try {
      const { id, title, content, revision, parentId, scope, projectId } =
        await this.reads.readWithoutVisit(actor, pageId);
      return { id, title, content, revision, parentId, scope, projectId };
    } catch (error: unknown) {
      if (error instanceof WikiPageNotFoundError)
        throw new AgentOperationError("NOT_FOUND");
      throw error;
    }
  }

  /** Returns at most 100 visible nodes, removing parent references outside the returned window. */
  public async tree(actor: User, projectId?: string): Promise<AgentWikiTree> {
    const all = (await this.reads.visibleNodes(actor)).filter(
      (node) => projectId === undefined || node.projectId === projectId,
    );
    const window = all.slice(0, PAGES_AGENT_LIMITS.treeNodes);
    const ids = new Set(window.map((node) => node.id));
    return {
      nodes: window.map(({ id, title, parentId }) => ({
        id,
        title,
        parentId: parentId !== null && ids.has(parentId) ? parentId : null,
      })),
      total: all.length,
      truncated: all.length > window.length,
    };
  }

  /** Returns at most 20 visible hits with 200 Unicode characters per snippet; totals share their policy. */
  public async search(
    actor: User,
    text: string,
    projectId?: string,
  ): Promise<AgentWikiSearch> {
    const found = await this.searches.search(actor, {
      text,
      titleOnly: false,
      location: projectId === undefined ? null : `project:${projectId}`,
      underPageId: null,
      creatorId: null,
      editedFrom: null,
      editedTo: null,
      sort: "relevance",
    });
    const results = found.results
      .slice(0, PAGES_AGENT_LIMITS.searchResults)
      .map(({ id, title, snippet }) => ({
        id,
        title,
        snippet: Array.from(snippet)
          .slice(0, PAGES_AGENT_LIMITS.snippetCharacters)
          .join(""),
      }));
    return {
      results,
      total: found.total,
      truncated: found.total > results.length,
    };
  }
}
