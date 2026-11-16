/**
 * Contracts of the chat page with people, agents and groups.
 * @remarks
 * The page reads one {@link VirtualChatDirectory}: the participants a person
 * keeps in their own list, the people and agents the list can take, and the
 * history with every agent. Agents are created only in the user
 * administration; the chat chooses among existing accounts. Participants and
 * groups are stored per account and ordered by their last activity, newest
 * first.
 */

import type { ConversationMentionDirectory } from "./ConversationMention";
import type {
  ChatDecisionStatus,
  ConversationReplyMode,
} from "./ConversationDecision";

import type { AgentEmployeeAccess } from "./AgentEmployee";
import type { AgentQuestionView } from "./AgentChatQuestion";
import type { AgentChatSessionBrief } from "./AgentChatSession";
import type { AgentChatModelLabel } from "./AgentChatControl";
import type { AgentMessageQueue } from "./AgentSessionLimits";
import type { ConversationNotice } from "./Conversation";
import type {
  ChatEmbedDomains,
  ChatViewPreferences,
  ConversationAttachment,
  ConversationAttachmentReference,
  ConversationLink,
} from "./ConversationContent";
import type { ConversationDecisionView } from "./ConversationDecision";

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
   * The stored direct conversation with a person; `null` before
   * the first message and for an agent, whose history is its chat session.
   */
  readonly conversationId?: string | null;
  /** Whether the person muted the stored direct conversation for themselves alone. */
  readonly isMuted?: boolean;
  /**
   * The direct conversation in which the agent wrote to the person;
   * its messages stand in the history, and reading marks it read up to the
   * newest of them.
   */
  readonly agentChat?: {
    readonly conversationId: string;
    readonly newestMessageId: string;
  };
  /** ISO time of the adding or the last sent message. */
  readonly lastActivityAt: string;
  /** The access level of an agent, shown in the head of its chat. */
  readonly accessLevel?: AgentEmployeeAccess;
  /** Whether the person marked the direct chat with this agent confidential. */
  readonly isConfidential?: boolean;
  /** The session of this agent in its direct chat with the person; absent before the first message. */
  readonly session?: AgentChatSessionBrief;
  /** The model this agent answers with in its direct chat with the person. */
  readonly chatModel?: AgentChatModelLabel;
}

/** A group of participants with one shared history. */
export interface VirtualGroup {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Participant ids in display order. */
  readonly memberIds: readonly string[];
  readonly unreadCount: number;
  /** Whether the person muted the group for themselves alone. */
  readonly isMuted?: boolean;
  /** ISO time of the creation or the last sent message. */
  readonly lastActivityAt: string;
  /** The names of the agents answering in the group now. */
  readonly workingAgentNames?: readonly string[];
  /** The agents answering in the group now, each of which can be stopped alone. */
  readonly workingAgents?: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  /** Whether the group is marked confidential: its agents share and learn nothing from it. */
  readonly isConfidential?: boolean;
  /**
   * A conversation in which only agents take part, which the person reads as
   * an administrator or leader without being a member; nobody
   * writes in it from the page.
   */
  readonly isAgentConversation?: boolean;
  /** The agents of an {@link VirtualGroup.isAgentConversation}, which the person's list does not hold. */
  readonly agentMembers?: readonly VirtualParticipant[];
  /** Agents wrote the most they may in a row and wait for a person to allow it to go on. */
  readonly isAgentPaused?: boolean;
  /** The sessions of the agents of the group in this group, one per agent. */
  readonly agentSessions?: readonly AgentChatSessionBrief[];
  /** The model each agent of the group answers with in it, by agent. */
  readonly agentModels?: Readonly<Record<string, AgentChatModelLabel>>;
  /** Whether the person created the group, so adds and removes members and dissolves it. */
  readonly isOwner?: boolean;
  /** Whether the person may change the model of its agents and restart or compact their sessions. */
  readonly canControlSessions?: boolean;
  /** Who answers in the group, which the entry "Wer antwortet?" of the group menu names. */
  readonly replyMode?: ConversationReplyMode;
}

/** A tool a participant used for an answer, for example `list_tickets · 3 offen`. */
export interface VirtualToolUse {
  readonly name: string;
  readonly detail: string;
  /** The ID of the call within its job. */
  readonly callId?: string;
  readonly status?: "running" | "completed" | "failed" | "cancelled";
  /** How long the call took, in milliseconds, where the page saw it run. */
  readonly durationMs?: number;
  /** The command or input of the call, bounded and with credentials masked. */
  readonly input?: string;
  /** The result of the call, bounded and with credentials masked. */
  readonly output?: string;
  /** A tool of the host rather than a Pages tool. */
  readonly isNative?: boolean;
  /** What the tool does, in one short sentence. */
  readonly summary?: string;
}

/** The audio of a voice message. */
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
  /** The account IDs the text mentions with `@username`, as stored. */
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
  /** Present only for a hint why an agent did not answer. */
  readonly notice?: ConversationNotice;
  /**
   * The decision of the decision model: on the message of a person
   * that nobody answered, which the chat shows as a quiet line; on the answer
   * of an agent the decision model chose, which the chat shows as "Why?".
   */
  readonly decision?: ConversationDecisionView;
  /**
   * Present while the answer to this message waits: for the answer
   * the agent gives in this chat, or for a free place among the limits.
   */
  readonly queue?: AgentMessageQueue;
  /**
   * The agents whose running answer took this message of the person,
   * which the chat shows as "in Eds Antwort eingeschoben".
   */
  readonly steeredInto?: readonly string[];
  /** The files of a stored message. */
  readonly attachments?: readonly ConversationAttachment[];
  /**
   * The address of the ZIP archive of the files, where the message is no
   * message of a stored conversation; absent uses the archive of the
   * conversation.
   */
  readonly archiveUrl?: string;
  /**
   * The person sent this message from a preview of the chat; the
   * chat marks it "aus der Vorschau gesendet". Absent for every other message.
   */
  readonly isFromPreview?: boolean;
  /** What the server knows of the URLs that stand alone in a line. */
  readonly links?: readonly ConversationLink[];
  /** Earlier attachments of the chat an agent shows again. */
  readonly references?: readonly ConversationAttachmentReference[];
  /** Whether the person may delete the message: their own stored one. */
  readonly canDelete?: boolean;
  /** An interim message an agent wrote during its round; the chat shows it quieter. */
  readonly isInterim?: boolean;
  /** The question with answer buttons the message carries. */
  readonly question?: AgentQuestionView;
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
  /** Current public health, with no connection or credential details. */
  readonly chatDecisionStatus?: ChatDecisionStatus;
  readonly mentionDirectory?: ConversationMentionDirectory;
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
   * messages than the ones shown, which the page loads page by page.
   */
  readonly olderHistoryIds?: readonly string[];
  /**
   * The tool calls of the answer an agent is working on now, by the agent's
   * id; a running call can be cancelled.
   */
  readonly liveToolUses?: Readonly<Record<string, readonly VirtualToolUse[]>>;
  /** People and agents the dialog "Teilnehmer hinzufügen" offers; never the own account. */
  readonly contactChoices: readonly VirtualContactChoice[];
  /** The longest voice message Pages takes, in milliseconds. */
  readonly voiceMaximumMs?: number;
  /** The domains that may be embedded in conversations. */
  readonly embedDomains?: ChatEmbedDomains;
  /** The person's card states and split width. */
  readonly viewPreferences?: ChatViewPreferences;
}

/** A page of older messages of a stored conversation. */
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
