import type { AgentTextPatch, AgentTextPatched } from "./AgentTextRange.js";
import type {
  AgentDirectoryEntry,
  AgentMilestoneReference,
  AgentTag,
  AgentVisiblePerson,
  AgentWikiPageReference,
} from "./AgentExtensions.js";

/** Types a ticket can have; mirrors the work item types of Pages. */
export type AgentTicketType = "initiative" | "epic" | "task" | "subtask";

/** States of a milestone. */
export type AgentMilestoneStatus = "open" | "completed" | "archived";

/** How two milestones depend on each other, from the source to the target. */
export type AgentMilestoneLinkType =
  "prerequisite" | "follows" | "blocks" | "relates_to";

/** A ticket is named by its identifier or by its key; an address is resolved before this contract. */
export type AgentTicketReference =
  { readonly id: string } | { readonly key: string };

/** The ticket fields an agent changes one at a time. */
export type AgentTicketField = "title" | "description" | "status" | "parent";

/** Operations that change exactly one field of a ticket. */
export type AgentTicketFieldOperation =
  | "ticket.setTitle"
  | "ticket.setDescription"
  | "ticket.setStatus"
  | "ticket.setParent";

/** Every ticket write: the local create, the single-field changes and the description range patch. */
export type AgentTicketOperation =
  "ticket.create" | "ticket.patchDescription" | AgentTicketFieldOperation;

/** The milestone fields an agent changes one at a time. */
export type AgentMilestoneField =
  "name" | "description" | "status" | "startAt" | "dueAt";

/** Operations that change exactly one field of a milestone. */
export type AgentMilestoneFieldOperation =
  | "milestone.setName"
  | "milestone.setDescription"
  | "milestone.setStatus"
  | "milestone.setStartAt"
  | "milestone.setDueAt";

/** Every milestone write: create, single-field changes and dependencies. */
export type AgentMilestoneOperation =
  | "milestone.create"
  | AgentMilestoneFieldOperation
  | "milestone.dependency.add"
  | "milestone.dependency.remove";

/** What a new ticket is assigned to: a person, a group, or nobody. */
export interface AgentTicketAssignee {
  readonly targetType: "person" | "group" | "none";
  /** `null` exactly when `targetType` is `none`. */
  readonly targetId: string | null;
}

/**
 * A new ticket; it is created locally and never overwrites.
 *
 * @remarks
 * What a call leaves open is taken from the parent and the account, never
 * invented: the project and a milestone and department the parent carries, and
 * the account that creates the ticket as its assignee.
 */
export interface AgentTicketCreateInput {
  readonly operationId: string;
  /** `null` takes the project of the parent. */
  readonly projectId: string | null;
  readonly type: AgentTicketType;
  readonly title: string;
  readonly description: string;
  /** `null` takes the status new tickets of the project start in. */
  readonly statusId: string | null;
  readonly parent: AgentTicketReference | null;
  /** `null` takes the milestone of the parent, when it has one. */
  readonly milestoneId: string | null;
  /** Absent or `null` takes the department of the parent, when it has one and the account may select it. */
  readonly departmentId?: string | null;
  /** Absent or `null` assigns the account that creates the ticket. */
  readonly assignee?: AgentTicketAssignee | null;
}

/** The ticket a field change addresses. */
export interface AgentTicketTarget {
  readonly operationId: string;
  readonly ticket: AgentTicketReference;
}

/** A change of the title, the description or the status, with the value it was read with. */
export interface AgentTicketTextChange {
  readonly field: "title" | "description" | "status";
  readonly expected: string;
  readonly value: string;
}

/** A change of the parent; `null` is no parent. */
export interface AgentTicketParentChange {
  readonly field: "parent";
  readonly expected: AgentTicketReference | null;
  readonly value: AgentTicketReference | null;
}

/** The single field to change, the value it was read with and its new value. */
export type AgentTicketFieldChange =
  AgentTicketTextChange | AgentTicketParentChange;

/** One field of one ticket; the other fields stay as they are. */
export type AgentTicketFieldInput = AgentTicketTarget & AgentTicketFieldChange;

/**
 * One range of the description of a ticket, bound to the version the caller read.
 * The complete description is no part of the request.
 */
export interface AgentTicketDescriptionPatchInput
  extends AgentTicketTarget, AgentTextPatch {
  /** The `descriptionVersion` of the passage read last. */
  readonly expectedVersion: string;
}

/** A new milestone in an explicit project. */
export interface AgentMilestoneCreateInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly startAt: string | null;
  readonly dueAt: string | null;
}

/** One field of one milestone, the value it was read with and its new value. */
export interface AgentMilestoneFieldInput {
  readonly operationId: string;
  readonly milestoneId: string;
  readonly field: AgentMilestoneField;
  readonly expected: string | null;
  readonly value: string | null;
}

/** A new dependency between two milestones of one project. */
export interface AgentMilestoneDependencyAddInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly linkType: AgentMilestoneLinkType;
}

/** The dependency to remove from a project. */
export interface AgentMilestoneDependencyRemoveInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly dependencyId: string;
}

/** Result of a ticket create; returned unchanged when the operation ID is repeated. */
export interface AgentTicketCreated {
  readonly ticketId: string;
  readonly key: string;
  readonly link: string;
  readonly statusId: string;
}

/** Result of a ticket field change; returned unchanged when the operation ID is repeated. */
export interface AgentTicketChanged {
  readonly ticketId: string;
  readonly key: string;
  readonly link: string;
  readonly field: AgentTicketField;
  /** Whether the call wrote anything; `false` when the value was already set. */
  readonly changed: boolean;
}

/**
 * Result of a description range patch; returned unchanged when the operation ID is repeated.
 *
 * @remarks
 * `start` and `end` delimit the replacement text in the new description. The
 * new description is not part of the result unless `after` was asked for.
 */
export interface AgentTicketDescriptionPatched
  extends AgentTicketChanged, AgentTextPatched {
  readonly field: "description";
  /** The version of the description after the call; unchanged when nothing was written. */
  readonly descriptionVersion: string;
}

/** Result of a milestone create; returned unchanged when the operation ID is repeated. */
export interface AgentMilestoneCreated {
  readonly milestoneId: string;
  readonly projectId: string;
}

/** Result of a milestone field change; returned unchanged when the operation ID is repeated. */
export interface AgentMilestoneChanged {
  readonly milestoneId: string;
  readonly projectId: string;
  readonly field: AgentMilestoneField;
  readonly changed: boolean;
}

/** Result of adding or removing a dependency; returned unchanged on a repeated operation ID. */
export interface AgentMilestoneDependencyChanged {
  readonly dependencyId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly linkType: AgentMilestoneLinkType;
  /** `true` when the call removed the dependency, `false` when it created it. */
  readonly removed: boolean;
}

/** A workflow status a ticket of the project can be in. */
export interface AgentTicketStatus {
  readonly id: string;
  readonly name: string;
  readonly isDone: boolean;
}

/**
 * The core fields of a visible ticket, without people, department or
 * integration data, and the statuses its project offers.
 */
export interface AgentTicket {
  readonly id: string;
  readonly key: string;
  readonly link: string;
  readonly projectId: string;
  readonly type: AgentTicketType;
  readonly title: string;
  readonly description: string;
  readonly priority: string;
  readonly statusId: string;
  readonly statusName: string;
  readonly isDone: boolean;
  /** `null` for no parent and for a parent the account cannot see. */
  readonly parentId: string | null;
  readonly parentKey: string | null;
  readonly milestoneId: string | null;
  readonly milestoneName: string | null;
  readonly startAt: string | null;
  readonly dueAt: string | null;
  readonly isArchived: boolean;
  readonly statuses: readonly AgentTicketStatus[];
  /** Tags of the catalog the ticket carries. */
  readonly tags: readonly AgentTag[];
  /** For an initiative: every milestone it is linked with, its own included. */
  readonly linkedMilestones?: readonly AgentMilestoneReference[];
  /** Visible wiki pages tied to an epic; omitted for other types. */
  readonly wikiPages?: readonly AgentWikiPageReference[];
  /**
   * Visible active epics, tasks and subtasks below the ticket. A deletion
   * moves them to the archive with it; given on a single read only.
   */
  readonly descendantCount?: number;
  readonly assignee?: AgentVisiblePerson | null;
  readonly assigneeGroup?: AgentDirectoryEntry | null;
  readonly department?: AgentDirectoryEntry | null;
}

/** A milestone of a visible project. */
export interface AgentMilestone {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly status: AgentMilestoneStatus;
  readonly startAt: string | null;
  readonly dueAt: string | null;
  /** Visible initiatives linked with the milestone, its tickets' own milestone included. */
  readonly initiatives: readonly AgentTicketReferenceEntry[];
  /** Visible wiki pages tied to the milestone. */
  readonly wikiPages: readonly AgentWikiPageReference[];
}

/** A visible ticket named by identifier, key and title. */
export interface AgentTicketReferenceEntry {
  readonly id: string;
  readonly key: string;
  readonly title: string;
}

/** A directed dependency between two milestones. */
export interface AgentMilestoneDependency {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly linkType: AgentMilestoneLinkType;
}

/** The milestones and dependencies of one visible project. */
export interface AgentMilestones {
  readonly projectId: string;
  readonly milestones: readonly AgentMilestone[];
  readonly dependencies: readonly AgentMilestoneDependency[];
  readonly total?: number;
  readonly nextCursor?: string | null;
}
