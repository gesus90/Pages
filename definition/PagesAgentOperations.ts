/** A9.5 read operations; every verified active account may read within its scope. */
export const PAGES_AGENT_READ_OPERATIONS = [
  "projects.resolve",
  "projects.read",
  "wiki.page.read",
  "wiki.tree.read",
  "wiki.search",
] as const;

/** An implemented A9.5 read operation. */
export type PagesAgentReadOperation =
  (typeof PAGES_AGENT_READ_OPERATIONS)[number];

/** Fixed wire limits, including the whole serialized UTF-8 response envelope. */
export const PAGES_AGENT_LIMITS = {
  requestBytes: 65_536,
  responseBytes: 1_048_576,
  candidates: 100,
  treeNodes: 100,
  searchResults: 20,
  snippetCharacters: 200,
  textCharacters: 200,
} as const;

/** A visible target offered for exact project resolution. */
export interface AgentProjectReference {
  readonly id: string;
  readonly name: string;
}

/** Explicit core fields without people, integration settings or invisible parent references. */
export interface AgentProjectDetails extends AgentProjectReference {
  readonly description: string;
  readonly status: string;
  readonly progress: number;
  readonly startDate: string | null;
  readonly targetDate: string | null;
}

/** Page text for a visible target; no favorites, visits, people or attachment metadata. */
export interface AgentWikiPage {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly revision: number;
  readonly parentId: string | null;
  readonly scope: string;
  readonly projectId: string | null;
}

/** A visible tree entry; parents outside the requested project or returned window are null. */
export interface AgentWikiNode {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
}

/** Bounded navigation with counts of visible nodes only. */
export interface AgentWikiTree {
  readonly nodes: readonly AgentWikiNode[];
  readonly total: number;
  readonly truncated: boolean;
}

/** A visible search passage without owner or project metadata. */
export interface AgentWikiSearchHit {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
}

/** Bounded search with counts derived by the same visibility query as the passages. */
export interface AgentWikiSearch {
  readonly results: readonly AgentWikiSearchHit[];
  readonly total: number;
  readonly truncated: boolean;
}

/** Business results added in A9.5; existing verify/name envelopes remain compatible. */
export interface PagesAgentReadResponse {
  readonly apiVersion: "1";
  readonly result:
    | AgentProjectReference
    | AgentProjectDetails
    | AgentWikiPage
    | AgentWikiTree
    | AgentWikiSearch;
}

/** Visible choices on ambiguity; no automatic selection even when the list is truncated. */
export interface AgentProjectCandidates {
  readonly candidates: readonly AgentProjectReference[];
  readonly truncated: boolean;
}
