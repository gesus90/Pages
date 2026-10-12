import type {
  AgentDirectoryEntry,
  AgentPageInfo,
  AgentTag,
  AgentVisiblePerson,
} from "./AgentExtensions.js";
import type { AgentTicketReference, AgentTicketType } from "./AgentTickets.js";

/** Reads that find tickets, show their hierarchy and links, and name assignment targets. */
export const AGENT_TICKET_NAVIGATION_READ_OPERATIONS = [
  "tickets.search",
  "tickets.tree.read",
  "tickets.links.read",
  "assignment.targets.search",
] as const;

/** Changes of the typed links between two tickets; the parent is a separate field operation. */
export const AGENT_TICKET_LINK_OPERATIONS = [
  "tickets.link.add",
  "tickets.link.remove",
] as const;

/** An implemented navigation read. */
export type AgentTicketNavigationReadOperation =
  (typeof AGENT_TICKET_NAVIGATION_READ_OPERATIONS)[number];

/** An implemented link change. */
export type AgentTicketLinkOperation =
  (typeof AGENT_TICKET_LINK_OPERATIONS)[number];

/** Relations between two tickets; mirrors the work item link types of Pages. */
export type AgentTicketLinkType = "blocks" | "relates_to" | "duplicates";

/** Who or what a ticket can be assigned to. */
export type AgentAssignmentTargetType = "person" | "group" | "department";

/** The filters of a ticket search; an absent filter does not restrict. */
export interface AgentTicketSearchInput {
  readonly projectId: string;
  /** Matched case-insensitively against key, title and description. */
  readonly text?: string;
  readonly type?: AgentTicketType;
  readonly statusId?: string;
  /** Only the direct children of this ticket. */
  readonly parent?: AgentTicketReference;
  readonly milestoneId?: string;
  readonly departmentId?: string;
  readonly assigneeId?: string;
  readonly assigneeGroupId?: string;
  /** Tickets that carry at least one of these tags. */
  readonly tagIds?: readonly string[];
}

/** A visible ticket as a search hit: no description, no status catalog. */
export interface AgentTicketSummary {
  readonly id: string;
  readonly key: string;
  readonly link: string;
  readonly projectId: string;
  readonly type: AgentTicketType;
  readonly title: string;
  readonly priority: string;
  readonly statusId: string;
  readonly statusName: string;
  readonly isDone: boolean;
  /** `null` for no parent and for a parent the account cannot see. */
  readonly parentId: string | null;
  readonly parentKey: string | null;
  readonly milestoneId: string | null;
  readonly milestoneName: string | null;
  readonly assignee: AgentVisiblePerson | null;
  readonly assigneeGroup: AgentDirectoryEntry | null;
  readonly department: AgentDirectoryEntry | null;
  readonly tags: readonly AgentTag[];
  /** Up to 200 characters of the description around the match; `null` when the match is elsewhere. */
  readonly snippet: string | null;
}

/** One page of matching tickets; counts and cursors derive from visible tickets only. */
export interface AgentTicketSearch extends AgentPageInfo {
  readonly projectId: string;
  readonly tickets: readonly AgentTicketSummary[];
}

/** A visible ticket in a hierarchy, with the references needed to rebuild the tree. */
export interface AgentTicketNode {
  readonly id: string;
  readonly key: string;
  readonly link: string;
  readonly type: AgentTicketType;
  readonly title: string;
  readonly statusId: string;
  readonly statusName: string;
  readonly isDone: boolean;
  /** `null` for no parent and for a parent the account cannot see. */
  readonly parentId: string | null;
  readonly parentKey: string | null;
  /** Visible active tickets directly below this one. */
  readonly childCount: number;
  /** The visible ancestors the ticket has; 0 for a ticket without a visible parent. */
  readonly depth: number;
}

/** Visible hierarchy of one project, or of the subtree below one ticket. */
export interface AgentTicketTree extends AgentPageInfo {
  readonly projectId: string;
  /** The requested ticket; `null` for a project tree. */
  readonly root: AgentTicketNode | null;
  /** Visible ancestors of the requested ticket, outermost first; empty for a project tree. */
  readonly path: readonly AgentTicketNode[];
  /** Descendants of the root, or every active ticket of the project. */
  readonly nodes: readonly AgentTicketNode[];
}

/** A link as the ticket read sees it; the other side sees the same `id` with the other direction. */
export interface AgentTicketLink {
  readonly id: string;
  readonly linkType: AgentTicketLinkType;
  /** `outgoing`: this ticket is the source ("this blocks the other"); `incoming`: the other is. */
  readonly direction: "outgoing" | "incoming";
  readonly ticket: {
    readonly id: string;
    readonly key: string;
    readonly title: string;
    readonly statusKey: string;
    readonly isDone: boolean;
  };
  readonly createdAt: string;
}

/** The visible links of one ticket. */
export interface AgentTicketLinks extends AgentPageInfo {
  readonly ticketId: string;
  readonly key: string;
  readonly links: readonly AgentTicketLink[];
}

/** Result of adding or removing a link; returned unchanged when the operation ID is repeated. */
export interface AgentTicketLinkChanged {
  readonly linkId: string;
  readonly linkType: AgentTicketLinkType;
  /** The direction of the link seen from `ticketId`. */
  readonly direction: "outgoing" | "incoming";
  readonly ticketId: string;
  readonly key: string;
  readonly linkedTicketId: string;
  readonly linkedKey: string;
  /** `true` when the call removed the link, `false` when it created it. */
  readonly removed: boolean;
}

/** The ticket and link a change addresses. */
export interface AgentTicketLinkAddInput {
  readonly operationId: string;
  readonly ticket: AgentTicketReference;
  readonly target: AgentTicketReference;
  readonly linkType: AgentTicketLinkType;
}

/** The link to remove from a ticket. */
export interface AgentTicketLinkRemoveInput {
  readonly operationId: string;
  readonly ticket: AgentTicketReference;
  readonly linkId: string;
}

/** A person, group or department a ticket can be assigned to, from the visible directory. */
export interface AgentAssignmentTarget {
  readonly targetType: AgentAssignmentTargetType;
  readonly id: string;
  readonly name: string;
  /** Whether the name equals the searched text, ignoring case; several exact hits are ambiguous. */
  readonly isExactMatch: boolean;
  /** Persons only: what tells two people of the same name apart. */
  readonly departments?: readonly AgentDirectoryEntry[];
  readonly groups?: readonly AgentDirectoryEntry[];
}

/** Assignment targets that matched, never resolved to one. */
export interface AgentAssignmentTargets extends AgentPageInfo {
  readonly targets: readonly AgentAssignmentTarget[];
}
