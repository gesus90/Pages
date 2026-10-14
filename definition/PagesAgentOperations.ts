import { AGENT_TICKET_NAVIGATION_READ_OPERATIONS } from "./AgentTicketNavigation.js";

import type { AgentExtensionReadResult } from "./AgentExtensions.js";
import type { AgentAdminReadResult } from "./AgentAdministration.js";
import type { AgentWorkspaceReadResult } from "./AgentWorkspaceOperations.js";
import type { AgentImportPlan } from "./AgentImportManifest.js";
import type { AgentStructuredImportPlan } from "./AgentStructuredImportManifest.js";
import type {
  AgentAssignmentTargets,
  AgentTicketLinks,
  AgentTicketSearch,
  AgentTicketTree,
} from "./AgentTicketNavigation.js";
import type { AgentMilestones, AgentTicket } from "./AgentTickets.js";
import type { AgentTicketChecklist } from "./AgentTicketChecklist.js";
import type { AgentWikiComments } from "./AgentWikiComments.js";
import type { WikiCover } from "./Wiki.js";

/** Read operations; every verified active account may read and plan within its scope. */
export const PAGES_AGENT_READ_OPERATIONS = [
  "projects.resolve",
  "projects.read",
  "wiki.page.read",
  "wiki.tree.read",
  "wiki.search",
  "wiki.import.plan",
] as const;

/**
 * Reads of tickets and milestones, which an agent needs before it can change
 * them: single reads, and the search, hierarchy, link and assignment target
 * reads that find the ticket to change.
 */
export const PAGES_AGENT_TICKET_READ_OPERATIONS = [
  "ticket.read",
  "ticket.checklist.read",
  "milestones.read",
  ...AGENT_TICKET_NAVIGATION_READ_OPERATIONS,
] as const;

/** Previews of structured imports; like every read they need no write right. */
export const PAGES_AGENT_STRUCTURED_READ_OPERATIONS = [
  "import.structured.plan",
] as const;

/**
 * Reading and changing the comments of wiki pages.
 *
 * @remarks
 * Every verified active account is offered these, also without the write
 * capability: commenting needs the right to see the page, as in the wiki.
 */
export const PAGES_AGENT_COMMENT_OPERATIONS = [
  "wiki.comments.read",
  "wiki.comment.add",
  "wiki.comment.edit",
  "wiki.comment.resolve",
  "wiki.comment.delete",
] as const;

/** An implemented structured import preview. */
export type PagesAgentStructuredReadOperation =
  (typeof PAGES_AGENT_STRUCTURED_READ_OPERATIONS)[number];

/** An implemented comment operation. */
export type PagesAgentCommentOperation =
  (typeof PAGES_AGENT_COMMENT_OPERATIONS)[number];

/** An implemented ticket or milestone read. */
export type PagesAgentTicketReadOperation =
  (typeof PAGES_AGENT_TICKET_READ_OPERATIONS)[number];

/** An implemented read or planning operation. */
export type PagesAgentReadOperation =
  (typeof PAGES_AGENT_READ_OPERATIONS)[number];

/** Fixed wire limits, including the whole serialized UTF-8 response envelope. */
export const PAGES_AGENT_LIMITS = {
  requestBytes: 65_536,
  wikiContentBytes: 1_048_576,
  /** Worst-case JSON escaping of wiki text, plus the metadata budget. */
  wikiEnvelopeBytes: 6 * 1_048_576 + 65_536,
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
  /** A single emoji, or `null` when the page has no icon. */
  readonly icon: string | null;
  /** The visual cover, or `null` when the page has none. */
  readonly cover: WikiCover | null;
  /** What the page is tied to; a visible page implies visible targets. */
  readonly anchors: readonly AgentWikiAnchor[];
}

/** A department, milestone or epic a page is tied to. */
export interface AgentWikiAnchor {
  readonly kind: "department" | "milestone" | "epic";
  readonly targetId: string;
  /** Name of the target; `null` when it no longer exists. */
  readonly label: string | null;
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
  readonly nextCursor?: string | null;
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
  readonly nextCursor?: string | null;
}

/** Business read/preview results; existing verify/name envelopes remain compatible. */
export interface PagesAgentReadResponse {
  readonly apiVersion: "1";
  readonly result:
    | AgentProjectReference
    | AgentProjectDetails
    | AgentWikiPage
    | AgentWikiTree
    | AgentWikiSearch
    | AgentImportPlan
    | AgentTicket
    | AgentTicketChecklist
    | AgentMilestones
    | AgentTicketSearch
    | AgentTicketTree
    | AgentTicketLinks
    | AgentAssignmentTargets
    | AgentWikiComments
    | AgentExtensionReadResult
    | AgentAdminReadResult
    | AgentWorkspaceReadResult;
}

/** Version-one result of a structured import preview. */
export interface PagesAgentStructuredReadResponse {
  readonly apiVersion: "1";
  readonly result: AgentStructuredImportPlan;
}

/** Visible choices on ambiguity; no automatic selection even when the list is truncated. */
export interface AgentProjectCandidates {
  readonly candidates: readonly AgentProjectReference[];
  readonly truncated: boolean;
}

/** Public limit names, shared with the MCP error whitelist. */
export const AGENT_LIMIT_CONSTRAINTS = [
  "wikiContentBytes",
  "requestBytes",
  "responseBytes",
  "importIndexEntries",
  "importFiles",
  "importFileBytes",
  "importContentBytes",
  "importPathBytes",
  "importSources",
  "importLinks",
  "importAssets",
] as const;

/** Fixed numeric rejection detail; never includes document text, credentials or target names. */
export interface AgentLimitDetails {
  readonly constraint: (typeof AGENT_LIMIT_CONSTRAINTS)[number];
  readonly limit: number;
}

/** Credential-safe, whitelisted business failure details. */
export interface AgentRevisionConflict {
  readonly currentRevision: number;
}

export type AgentOperationDetails =
  AgentProjectCandidates | AgentLimitDetails | AgentRevisionConflict;
