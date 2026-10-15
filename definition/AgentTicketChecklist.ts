/** Where a checklist entry of a ticket lives. */
export type AgentChecklistSource = "criteria" | "description";

/**
 * One checkbox of a ticket, as the ticket page and agents see it.
 *
 * @remarks
 * `criteria` entries are the acceptance criteria of the ticket. `description`
 * entries are the task list items of its Markdown description; code blocks
 * never contribute entries. The identifier stays the same when only the
 * checkbox changes.
 */
export interface AgentChecklistItem {
  readonly id: string;
  readonly source: AgentChecklistSource;
  readonly text: string;
  readonly checked: boolean;
  /** Position among all entries of the ticket, starting at 0. */
  readonly order: number;
  /** Number of enclosing description entries; acceptance criteria are 0. */
  readonly depth: number;
  /** The enclosing description entry, or `null` at the top level. */
  readonly parentId: string | null;
}

/** The checklist of one visible ticket at one revision. */
export interface AgentTicketChecklist {
  readonly ticketId: string;
  readonly key: string;
  readonly link: string;
  /**
   * Grows with every change through the agent API and whenever the
   * description or the acceptance criteria differ from the last read; it
   * never goes back.
   */
  readonly revision: string;
  readonly items: readonly AgentChecklistItem[];
}

/** The outcome of setting one checklist entry. */
export interface AgentChecklistItemChanged {
  readonly ticketId: string;
  readonly key: string;
  readonly itemId: string;
  readonly checked: boolean;
  /** `false` when the entry already had the requested state. */
  readonly changed: boolean;
  /** The revision after the call, for the next change. */
  readonly revision: string;
}

/** One entry of a bulk change: the entry and the state it must have afterwards. */
export interface AgentChecklistItemState {
  readonly itemId: string;
  readonly checked: boolean;
}

/**
 * The outcome of setting several checklist entries in one call.
 *
 * @remarks
 * It is the complete checklist as it is after the call, in the shape
 * `ticket.checklist.read` returns, so the next change needs no further read.
 */
export interface AgentChecklistItemsChanged extends AgentTicketChecklist {
  /** How many entries differed from the requested state; `0` when nothing was written. */
  readonly changedCount: number;
}
