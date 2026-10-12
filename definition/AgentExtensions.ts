import type { AgentTicket } from "./AgentTickets.js";
import type { ProjectActivity } from "./Project.js";

/** Additional A11.1 and A11.5 reads, authorized by Pages on every invocation. */
export const AGENT_EXTENSION_READ_OPERATIONS = [
  "departments.list",
  "groups.list",
  "people.visible.list",
  "wiki.outline.read",
  "wiki.links.read",
  "projects.members.read",
  "projects.activity.read",
  "projects.tickets.list",
  "tags.list",
] as const;

/**
 * Basic mutations complementing the existing granular wiki and planning tools:
 * A11.1 assignments and deletions, A11.5 tags and links.
 */
export const AGENT_EXTENSION_WRITE_OPERATIONS = [
  "wiki.page.delete",
  "projects.create",
  "projects.setName",
  "projects.setDescription",
  "projects.setStatus",
  "projects.setDates",
  "projects.member.assign",
  "projects.member.remove",
  "ticket.setAssignee",
  "ticket.assignMilestone",
  "ticket.delete",
  "milestone.delete",
  "ticket.setTags",
  "milestone.initiative.add",
  "milestone.initiative.remove",
  "wiki.page.setAnchors",
] as const;

export type AgentExtensionReadOperation =
  (typeof AGENT_EXTENSION_READ_OPERATIONS)[number];
export type AgentExtensionWriteOperation =
  (typeof AGENT_EXTENSION_WRITE_OPERATIONS)[number];

/** A tag of the catalog; people assign tags, they cannot create them (T6.13.4). */
export interface AgentTag {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** A milestone named by its identifier. */
export interface AgentMilestoneReference {
  readonly id: string;
  readonly name: string;
}

/** A page of the wiki named by its identifier. */
export interface AgentWikiPageReference {
  readonly id: string;
  readonly title: string;
}

/** Cursor navigation over entries that passed the current visibility checks. */
export interface AgentPageInfo {
  readonly nextCursor: string | null;
  readonly total: number;
}

/** Fields safe to expose for a selectable department or group. */
export interface AgentDirectoryEntry {
  readonly id: string;
  readonly name: string;
}

/** Public identity projection; identifiers support assignments, other profile fields stay private. */
export interface AgentVisiblePerson {
  readonly id: string;
  readonly displayName: string;
  readonly departments: readonly AgentDirectoryEntry[];
  readonly groups: readonly AgentDirectoryEntry[];
}

export interface AgentDirectoryList extends AgentPageInfo {
  readonly entries: readonly AgentDirectoryEntry[];
}

export interface AgentTagList extends AgentPageInfo {
  readonly tags: readonly AgentTag[];
}

export interface AgentPeopleList extends AgentPageInfo {
  readonly people: readonly AgentVisiblePerson[];
}

export interface AgentProjectMembers extends AgentPageInfo {
  readonly projectId: string;
  readonly members: readonly (AgentVisiblePerson & { readonly role: string })[];
  readonly departments: readonly AgentDirectoryEntry[];
}

export interface AgentProjectActivity extends AgentPageInfo {
  readonly projectId: string;
  readonly entries: readonly (Omit<
    ProjectActivity,
    "userId" | "userDisplayName"
  > & {
    readonly actor?: AgentVisiblePerson;
  })[];
}

export interface AgentProjectTickets extends AgentPageInfo {
  readonly projectId: string;
  readonly tickets: readonly AgentTicket[];
}

export interface AgentWikiHeading {
  readonly id: string;
  readonly level: number;
  readonly text: string;
}

export interface AgentWikiOutline extends AgentPageInfo {
  readonly pageId: string;
  readonly revision: number;
  readonly headings: readonly AgentWikiHeading[];
}

export interface AgentWikiLinks extends AgentPageInfo {
  readonly pageId: string;
  readonly outgoing: readonly { readonly id: string; readonly title: string }[];
  readonly incoming: readonly { readonly id: string; readonly title: string }[];
}

/** Explicit mutation result, committed together with its activity and replay record. */
export interface AgentExtensionChanged {
  readonly id: string;
  readonly projectId: string | null;
  readonly changed: boolean;
  /** The other end of a link change: the initiative of a milestone link. */
  readonly relatedId?: string;
  readonly affectedCount?: number;
  readonly recursive?: boolean;
  readonly disposition?: "trash";
}

export type AgentExtensionReadResult =
  | AgentTagList
  | AgentDirectoryList
  | AgentPeopleList
  | AgentProjectMembers
  | AgentProjectActivity
  | AgentProjectTickets
  | AgentWikiOutline
  | AgentWikiLinks;
