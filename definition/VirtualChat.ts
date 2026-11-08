/**
 * Contracts of the chat page with virtual participants and groups (PAGE-254).
 *
 * @remarks
 * The page reads one {@link VirtualChatDirectory}. In PAGE-254 a fixed sample
 * source answers it; later tickets replace only that source with stored
 * participants, groups and histories.
 */

/** Whether a participant is available, busy with a task, or switched off. */
export type VirtualParticipantStatus = "active" | "working" | "off";

/** The semantic color of a participant; every value has a light and a dark token. */
export type VirtualParticipantColor =
  "primary" | "indigo" | "pink" | "teal" | "lime";

/** How a participant's avatar is drawn: initial letter or Pica's mascot. */
export type VirtualParticipantAvatar = "initial" | "pica";

/** Reasoning levels a participant may be given. */
export type VirtualParticipantReasoning = "low" | "medium" | "high";

/** A virtual participant: an agent with a fixed role and task. */
export interface VirtualParticipant {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  /** The participant's standing task, shown as "Aufgabe: …". */
  readonly task: string;
  /** Display name of the model the participant answers with. */
  readonly model: string;
  readonly reasoning: VirtualParticipantReasoning;
  /** Display names of the tools the participant may use. */
  readonly tools: readonly string[];
  readonly color: VirtualParticipantColor;
  readonly avatar: VirtualParticipantAvatar;
  readonly status: VirtualParticipantStatus;
  readonly unreadCount: number;
}

/** A group of participants with one shared history. */
export interface VirtualGroup {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Participant ids in display order. */
  readonly memberIds: readonly string[];
  readonly unreadCount: number;
}

/** A tool a participant used for an answer, for example `list_tickets · 3 offen`. */
export interface VirtualToolUse {
  readonly name: string;
  readonly detail: string;
}

/** One message of a history. */
export interface VirtualChatMessage {
  readonly id: string;
  /** The answering participant, or `null` for the person's own message. */
  readonly authorId: string | null;
  /** Markdown text of the message. */
  readonly content: string;
  readonly toolUses: readonly VirtualToolUse[];
}

/** What the list can open: a group or a single participant. */
export interface VirtualChatSelection {
  readonly kind: "group" | "participant";
  readonly id: string;
}

/** Everything the chat page shows. */
export interface VirtualChatDirectory {
  readonly participants: readonly VirtualParticipant[];
  readonly groups: readonly VirtualGroup[];
  /**
   * The one continuous history of every participant and group, by its id.
   * There is no list of several conversations per participant or group.
   */
  readonly histories: Readonly<Record<string, readonly VirtualChatMessage[]>>;
  /** Models the create dialog offers. */
  readonly modelChoices: readonly string[];
  /** Tools the create dialog offers. */
  readonly toolChoices: readonly string[];
}
