/**
 * Contracts of the stored conversations between people and agents (PAGE-278),
 * shared by the web chat page and Pica Mobile.
 *
 * @remarks
 * A direct conversation exists once per pair of participants; a group has a
 * name and members who all see the same history. Muting, the read state and
 * the unread count belong to one member. A voice message is a message with
 * audio in the file store of Pages; its text arrives after the sending.
 */

/** Longest text of a message, in characters. */
export const CONVERSATION_TEXT_MAXIMUM_LENGTH = 16_000;

/** Longest group name, in characters. */
export const CONVERSATION_NAME_MAXIMUM_LENGTH = 80;

/** Most members a group may have, its creator included. */
export const CONVERSATION_GROUP_MAXIMUM_MEMBERS = 50;

/**
 * Most messages an answering agent reads as context (PAGE-276): the newest
 * ones of the conversation, the message it answers included.
 */
export const CONVERSATION_AGENT_CONTEXT_MESSAGES = 20;

/**
 * Most characters of message text an answering agent reads as context; older
 * messages drop out first, and the message it answers always stays.
 */
export const CONVERSATION_AGENT_CONTEXT_CHARACTERS = 12_000;

/** Most messages one page of the history holds. */
export const CONVERSATION_HISTORY_PAGE_SIZE = 50;

/** Largest audio file of a voice message, in bytes. */
export const CONVERSATION_VOICE_MAXIMUM_BYTES = 25 * 1024 * 1024;

/**
 * Longest voice message in seconds while `config.toml` sets none (PAGE-277);
 * `speechRecognition.maximumRecordingSeconds` sets the longest recording.
 */
export const CONVERSATION_VOICE_DEFAULT_DURATION_SECONDS = 5 * 60;

/** The longest recording an operator may set, in seconds. */
export const CONVERSATION_VOICE_DURATION_RANGE_SECONDS = {
  minimum: 1,
  maximum: 60 * 60,
} as const;

/** The audio formats of a voice message and the types that name them. */
export const CONVERSATION_VOICE_MIME_TYPES = {
  wav: ["audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave"],
  mp3: ["audio/mpeg", "audio/mp3"],
} as const;

/** One audio format of a voice message. */
export type ConversationVoiceFormat =
  keyof typeof CONVERSATION_VOICE_MIME_TYPES;

/** Whether a conversation is between two participants or a named group. */
export type ConversationKind = "direct" | "group";

/** Whether a participant is a person or an agent. */
export type ConversationParticipantKind = "human" | "agent";

/**
 * Why an agent did not answer (PAGE-276): it was deactivated, its cost limit
 * was reached, no model could run it, or its answer failed. A message with a
 * notice is a hint from Pages in the agent's name, never an answer.
 */
export type ConversationNotice =
  "agent_inactive" | "agent_cost_limit" | "agent_unavailable" | "agent_failed";

/** Where the text of a voice message stands. */
export type ConversationTranscriptionState = "pending" | "done" | "failed";

/** A person or agent as a conversation shows it. */
export interface ConversationParticipant {
  readonly id: string;
  readonly kind: ConversationParticipantKind;
  readonly name: string;
  /** The person color as `#rrggbb`; `null` without a chosen color. */
  readonly color: string | null;
}

/** A person or agent a new conversation can include. */
export interface ConversationContact extends ConversationParticipant {
  readonly username: string;
  /** The job title of an agent; empty for a person. */
  readonly role: string;
}

/** The people and agents a new conversation can include; never the own account. */
export interface ConversationContacts {
  readonly people: readonly ConversationContact[];
  readonly agents: readonly ConversationContact[];
}

/** One page of the conversation list of a member. */
export interface ConversationListPage {
  readonly items: readonly ConversationSummary[];
  /** Continues the list; `null` on its last page. */
  readonly nextCursor: string | null;
  /** Every unread message of the member, muted conversations included. */
  readonly totalUnread: number;
}

/** The read state of a member after a change of it. */
export interface ConversationReadState {
  readonly conversationId: string;
  readonly upToMessageId: string;
  readonly unreadCount: number;
  readonly totalUnread: number;
}

/** The audio part of a voice message. */
export interface ConversationVoice {
  readonly durationMs: number;
  readonly transcriptionState: ConversationTranscriptionState;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/** A stored message of a conversation. */
export interface ConversationMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly clientMessageId: string;
  readonly sender: ConversationParticipant;
  /** The written text, or the recognized text of a voice message; empty until it is known. */
  readonly text: string;
  /** ISO 8601 moment the message was stored. */
  readonly createdAt: string;
  /** IDs of the members the text mentions with `@username`. */
  readonly mentions: readonly string[];
  /** Present only for a voice message. */
  readonly voice?: ConversationVoice;
  /** Present only for a hint why an agent did not answer; `text` then says it in German. */
  readonly notice?: ConversationNotice;
}

/** A conversation as one member sees it. */
export interface ConversationSummary {
  readonly id: string;
  readonly kind: ConversationKind;
  /** The group name, or the name of the other participant of a direct conversation. */
  readonly name: string;
  readonly members: readonly ConversationParticipant[];
  readonly lastMessage: ConversationMessage | null;
  /** ISO 8601 moment of the creation or the newest message. */
  readonly lastActivityAt: string;
  /** Messages of others the member has not read; muting does not change it. */
  readonly unreadCount: number;
  readonly isMuted: boolean;
}

/** One page of a history: oldest first, with whether older messages exist. */
export interface ConversationHistoryPage {
  readonly conversationId: string;
  readonly messages: readonly ConversationMessage[];
  readonly hasMore: boolean;
}

/** Stable reasons a conversation request is refused. */
export type ConversationErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "too_large"
  | "too_long"
  | "unsupported_format";
