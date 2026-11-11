/**
 * Contracts of the chat page with people, agents and groups (PAGE-254,
 * PAGE-266, PAGE-259).
 *
 * @remarks
 * The page reads one {@link VirtualChatDirectory}: the participants a person
 * keeps in their own list, the people and agents the list can take, and the
 * history with every agent. Agents are created only in the user
 * administration; the chat chooses among existing accounts. Participants and
 * groups are stored per account and ordered by their last activity, newest
 * first.
 */

import type { ConversationNotice } from "./Conversation";
import type {
  ChatEmbedDomains,
  ChatViewPreferences,
  ConversationAttachment,
  ConversationLink,
} from "./ConversationContent";

/** Whether a participant is available, busy with a task, or switched off. */
export type VirtualParticipantStatus = "active" | "working" | "off";

/** Whether a participant is a person or an agent. */
export type VirtualParticipantKind = "human" | "agent";

/** A participant of the person's own list: a person or an agent. */
export interface VirtualParticipant {
  /** The user ID of the account. */
  readonly id: string;
  readonly name: string;
  readonly kind: VirtualParticipantKind;
  /** The job title of an agent; empty for a person, who shows the username. */
  readonly role: string;
  /** The username of the account. */
  readonly username: string;
  /** The person color as `#rrggbb`; `null` keeps the former look. */
  readonly color: string | null;
  readonly avatarImageUrl: string | null;
  readonly status: VirtualParticipantStatus;
  readonly unreadCount: number;
  /** Whether a message can be sent: to an active agent or an active person. */
  readonly canChat: boolean;
  /**
   * The stored direct conversation with a person (PAGE-278); `null` before
   * the first message and for an agent, whose history is its chat session.
   */
  readonly conversationId?: string | null;
  /** Whether the person muted the stored direct conversation for themselves alone (PAGE-275). */
  readonly isMuted?: boolean;
  /** ISO time of the adding or the last sent message. */
  readonly lastActivityAt: string;
}

/** A group of participants with one shared history. */
export interface VirtualGroup {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Participant ids in display order. */
  readonly memberIds: readonly string[];
  readonly unreadCount: number;
  /** Whether the person muted the group for themselves alone (PAGE-275). */
  readonly isMuted?: boolean;
  /** ISO time of the creation or the last sent message. */
  readonly lastActivityAt: string;
  /** The names of the agents answering in the group now (PAGE-276). */
  readonly workingAgentNames?: readonly string[];
}

/** A tool a participant used for an answer, for example `list_tickets · 3 offen`. */
export interface VirtualToolUse {
  readonly name: string;
  readonly detail: string;
}

/** The audio of a voice message (PAGE-278). */
export interface VirtualVoice {
  /** The address the browser plays it from; the server checks membership on every request. */
  readonly url: string;
  readonly durationMs: number;
  /** `pending` until the recognized text arrives, `failed` when none will. */
  readonly transcriptionState: "pending" | "done" | "failed";
}

/** One message of a history. */
export interface VirtualChatMessage {
  readonly id: string;
  /** The answering participant, or `null` for the person's own message. */
  readonly authorId: string | null;
  /** Markdown text of the message. */
  readonly content: string;
  /** ISO time the message was stored; missing for one still on its way. */
  readonly createdAt?: string;
  /** The account IDs the text mentions with `@username`, as stored (PAGE-275). */
  readonly mentions?: readonly string[];
  readonly toolUses: readonly VirtualToolUse[];
  /** The author as the conversation names it, for one outside the person's list. */
  readonly author?: {
    readonly name: string;
    readonly kind: VirtualParticipantKind;
    readonly color: string | null;
  };
  /** Present only for a voice message. */
  readonly voice?: VirtualVoice;
  /** Present only for a hint why an agent did not answer (PAGE-276). */
  readonly notice?: ConversationNotice;
  /** The files of a stored message (PAGE-298). */
  readonly attachments?: readonly ConversationAttachment[];
  /** What the server knows of the URLs that stand alone in a line (PAGE-298). */
  readonly links?: readonly ConversationLink[];
  /** Whether the person may delete the message: their own stored one (PAGE-298). */
  readonly canDelete?: boolean;
}

/** What the list can open: a group or a single participant. */
export interface VirtualChatSelection {
  readonly kind: "group" | "participant";
  readonly id: string;
}

/** A person or agent the participant dialog offers. */
export interface VirtualContactChoice {
  readonly id: string;
  readonly name: string;
  readonly kind: VirtualParticipantKind;
  /** The job title of an agent, or the username of a person. */
  readonly subtitle: string;
  readonly color: string | null;
  readonly avatarImageUrl: string | null;
  /** A deactivated agent stays visible but cannot be chosen. */
  readonly isSelectable: boolean;
}

/** Everything the chat page shows. */
export interface VirtualChatDirectory {
  /** The person's own participants, the latest activity first. */
  readonly participants: readonly VirtualParticipant[];
  /** The person's own groups, the latest activity first. */
  readonly groups: readonly VirtualGroup[];
  /**
   * The one continuous history of every participant and group, by its id.
   * There is no list of several conversations per participant or group.
   */
  readonly histories: Readonly<Record<string, readonly VirtualChatMessage[]>>;
  /**
   * The ids of the participants and groups whose stored history holds older
   * messages than the ones shown, which the page loads page by page (PAGE-275).
   */
  readonly olderHistoryIds?: readonly string[];
  /** People and agents the dialog "Teilnehmer hinzufügen" offers; never the own account. */
  readonly contactChoices: readonly VirtualContactChoice[];
  /** The longest voice message Pages takes, in milliseconds (PAGE-277). */
  readonly voiceMaximumMs?: number;
  /** The domains that may be embedded in conversations (PAGE-298). */
  readonly embedDomains?: ChatEmbedDomains;
  /** The person's card states and split width (PAGE-298). */
  readonly viewPreferences?: ChatViewPreferences;
}

/** A page of older messages of a stored conversation (PAGE-275). */
export interface VirtualChatHistoryPage {
  readonly conversationId: string;
  /** The messages before the requested one, oldest first. */
  readonly messages: readonly VirtualChatMessage[];
  /** Whether still older messages exist. */
  readonly hasMore: boolean;
}

/** Why sending to an agent was refused, as the interface translates it. */
export type VirtualChatSendFailure =
  "inactive" | "busy" | "unavailable" | "invalidInput" | "tooLong" | "tooLarge";

/** The longest group name. */
export const VIRTUAL_GROUP_NAME_LENGTH = 80;

/** The longest group description. */
export const VIRTUAL_GROUP_DESCRIPTION_LENGTH = 500;
