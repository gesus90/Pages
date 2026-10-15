/** The key of an agent run record, which is stored as a markdown file beside the database row. */
export interface AgentRunRecordKey {
  readonly agentId: string;
  readonly runId: string;
}

/**
 * The files whose database rows a project deletion removed.
 *
 * @remarks
 * The rows go in the deleting transaction; the files cannot, so the caller
 * removes them after the commit. A file that survives a failure there is no
 * longer referenced and the periodic sweeps remove it.
 */
export interface ProjectDeletionFiles {
  /** Storage names in the ticket attachment directory. */
  readonly ticketAttachments: readonly string[];
  /** Storage names in the wiki attachment directory. */
  readonly wikiAttachments: readonly string[];
  /** Records of agent runs, kept as files in the agent directory. */
  readonly agentRunRecords: readonly AgentRunRecordKey[];
}
