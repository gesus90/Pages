/** Reads that belong to the permanent deletion of a project; personal administrators only. */
export const AGENT_PROJECT_DELETION_READ_OPERATIONS = [
  "admin.projects.deletionScope",
] as const;

/** The permanent deletion of a project, with its confirmation word and replay record. */
export const AGENT_PROJECT_DELETION_WRITE_OPERATIONS = [
  "admin.projects.delete",
] as const;

/** A read that describes what the deletion of a project would remove. */
export type AgentProjectDeletionReadOperation =
  (typeof AGENT_PROJECT_DELETION_READ_OPERATIONS)[number];
/** The operation that deletes a project for good. */
export type AgentProjectDeletionWriteOperation =
  (typeof AGENT_PROJECT_DELETION_WRITE_OPERATIONS)[number];

/** Either word confirms the deletion, whatever language the account uses. */
export const PROJECT_DELETION_CONFIRMATIONS = ["LÖSCHEN", "DELETE"] as const;

/** A word that confirms the permanent deletion of a project. */
export type ProjectDeletionConfirmation =
  (typeof PROJECT_DELETION_CONFIRMATIONS)[number];

/**
 * Narrows an input to one of the two confirmation words.
 *
 * @param value - The confirmation the caller passed.
 * @returns Whether the value is exactly `LÖSCHEN` or `DELETE`.
 */
export function isProjectDeletionConfirmation(
  value: unknown,
): value is ProjectDeletionConfirmation {
  return PROJECT_DELETION_CONFIRMATIONS.some((word) => word === value);
}

/** What a deletion removes, counted per kind of data. */
export const PROJECT_DELETION_COUNT_KEYS = [
  "tickets",
  "subtickets",
  "ticketAttachments",
  "ticketChecklistItems",
  "ticketLinks",
  "ticketHistoryEntries",
  "milestones",
  "milestoneDependencies",
  "wikiPages",
  "wikiComments",
  "wikiAttachments",
  "plans",
  "planRuns",
  "workspaces",
  "importRuns",
  "importSources",
  "members",
  "departmentAssignments",
  "goals",
  "events",
  "activityEntries",
  "githubRecords",
  "integrations",
  "templates",
] as const;

/** One kind of data a project deletion removes. */
export type ProjectDeletionCountKey =
  (typeof PROJECT_DELETION_COUNT_KEYS)[number];

/** The number of rows of each kind that belong only to the project. */
export type ProjectDeletionCounts = Readonly<
  Record<ProjectDeletionCountKey, number>
>;

/** References from shared or other objects that the deletion clears instead of deleting them. */
export const PROJECT_DELETION_DETACHMENT_KEYS = [
  "templateAssignments",
  "wikiAnchors",
  "wikiLinks",
  "boardPreferences",
] as const;

/** One kind of reference that a project deletion clears elsewhere. */
export type ProjectDeletionDetachmentKey =
  (typeof PROJECT_DELETION_DETACHMENT_KEYS)[number];

/** The number of references of each kind that the deletion clears. */
export type ProjectDeletionDetachments = Readonly<
  Record<ProjectDeletionDetachmentKey, number>
>;

/** The project a deletion targets, as far as it identifies the target for a human. */
export interface ProjectDeletionTarget {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  /** Whether the project sits in the archive; deletion works for both. */
  readonly isArchived: boolean;
  readonly departmentNames: readonly string[];
}

/** The concrete project and the extent of the data its deletion removes. */
export interface ProjectDeletionScope {
  readonly project: ProjectDeletionTarget;
  /** Data that belongs only to the project and is removed. */
  readonly counts: ProjectDeletionCounts;
  /** References elsewhere that are cleared; the shared objects themselves stay. */
  readonly detached: ProjectDeletionDetachments;
}

/**
 * Tells whether every key received a number, which narrows a partial record to a complete one.
 *
 * @param keys - The keys the record must have.
 * @param values - The record read so far.
 * @returns Whether `values` holds a number for each key.
 */
export function hasAllCounts<Key extends string>(
  keys: readonly Key[],
  values: Partial<Record<Key, number>>,
): values is Record<Key, number> {
  return keys.every((key) => typeof values[key] === "number");
}
