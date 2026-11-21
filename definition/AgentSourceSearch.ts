/** The search over tickets, wiki pages and released ticket assets for an agent. */
export const AGENT_SOURCE_SEARCH_OPERATIONS = ["search.sources"] as const;

export type AgentSourceSearchOperation =
  (typeof AGENT_SOURCE_SEARCH_OPERATIONS)[number];

/** Most sections one search hands over. */
export const AGENT_SOURCE_SEARCH_MAX_SECTIONS = 20;

/** Longest question in Unicode characters. */
export const AGENT_SOURCE_SEARCH_MAX_QUESTION = 1000;

/** The kinds of sources a section is cut from. */
export type AgentSourceType = "ticket" | "wiki_page" | "ticket_asset";

/**
 * Why a section was found: `ticketKey` for a ticket number named exactly in
 * the question, `keyword` for the keyword search, `vector` for the vector search.
 */
export type AgentSourceMatch = "ticketKey" | "keyword" | "vector";

/** Why the vector search took no part; the keyword search answered alone. */
export type AgentVectorUnavailableReason =
  "notConfigured" | "embeddingFailed" | "vectorSearchUnavailable" | "timeout";

/** Whether the vector search took part in a search. */
export type AgentVectorSearchState =
  | { readonly status: "used"; readonly modelVersion: string }
  | {
      readonly status: "unavailable";
      readonly reason: AgentVectorUnavailableReason;
    };

/**
 * One section of a source the reader may see, with the link to the source.
 * @remarks
 * The text is cut from the current revision of the source; a stored section
 * of an older revision is never handed over.
 */
export interface AgentSourceSection {
  readonly sourceType: AgentSourceType;
  /** Ticket, wiki page or attachment identifier. */
  readonly sourceId: string;
  /** Ticket key and title, page title or file name. */
  readonly title: string;
  /** Pages address of the source: `/tasks/<key>`, `/wiki/<id>` or the attachment. */
  readonly link: string;
  /** Key of the ticket, or of the ticket an asset belongs to; `null` for wiki pages. */
  readonly ticketKey: string | null;
  /** Project of the source; `null` for instance and private wiki pages. */
  readonly projectId: string | null;
  /** Current revision of the source the text belongs to. */
  readonly sourceVersion: string;
  /** Position of the section in the source, from 0. */
  readonly sectionIndex: number;
  readonly text: string;
  readonly matchedBy: readonly AgentSourceMatch[];
}

/** Result of `search.sources`. */
export interface AgentSourceSearch {
  /** Sections in rank order; exactly named ticket numbers come first. */
  readonly sections: readonly AgentSourceSection[];
  readonly vectorSearch: AgentVectorSearchState;
  /** Vector hits left out because their source changed since it was indexed. */
  readonly staleSections: number;
}
