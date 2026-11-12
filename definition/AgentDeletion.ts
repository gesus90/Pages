/** An active plan run that must be stopped before its agent can be deleted. */
export interface AgentDeletionBlocker {
  readonly code: "active_runs";
  readonly detail: string;
  readonly link: string;
}

/** Counts of private agent artifacts that deletion will remove. */
export interface AgentDeletionCounts {
  readonly directChats: number;
  readonly sessions: number;
  readonly memoryEntries: number;
  readonly ownedPlans: number;
  readonly runs: number;
  readonly files: number;
  readonly credentials: number;
  readonly groupMemberships: number;
  readonly assignedTickets: number;
}

/** Counts of shared contributions that deletion preserves. */
export interface AgentDeletionKeeps {
  readonly groupChatMessages: number;
  readonly ticketChanges: number;
  readonly wikiChanges: number;
  readonly commits: number;
}

/** Inventory shown to a person before deleting an agent. */
export interface AgentDeletionPreview {
  readonly agentId: string;
  readonly displayName: string;
  readonly blockers: readonly AgentDeletionBlocker[];
  readonly deletes: AgentDeletionCounts;
  readonly keeps: AgentDeletionKeeps;
  readonly ownedPlans: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly previewId: string;
  readonly expiresAt: string;
}

/** Successful reversible deletion. */
export interface AgentDeletionResult {
  readonly agentId: string;
  readonly deletedAt: string;
  readonly restorableUntil: string;
}

/** A recently deleted agent in the administrator's list. */
export interface DeletedAgent {
  readonly agentId: string;
  readonly displayName: string;
  readonly deletedAt: string;
  readonly deletedBy: { readonly id: string; readonly displayName: string };
  readonly restorableUntil: string;
}
