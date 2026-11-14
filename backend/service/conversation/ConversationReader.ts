import { ConversationError } from "@/backend/error/ConversationError";
import { CONVERSATION_HISTORY_PAGE_SIZE } from "@/definition/Conversation";

import { EMPTY_MESSAGE_CONTENT } from "./content/ConversationMessageContent";
import { decisionView } from "./ConversationDecisionViews";

import type { ReadStream } from "node:fs";
import type { ConversationDecisionRepository } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationListPosition,
  ConversationRecord,
  ConversationRepository,
} from "@/backend/database/repositories/conversation/ConversationRepository";
import type { AgentConversationRecord } from "@/backend/database/repositories/conversation/ConversationAgentChatRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type {
  ConversationContact,
  ConversationContacts,
  ConversationHistoryPage,
  ConversationListPage,
  ConversationMessage,
  ConversationReadState,
  ConversationSummary,
  ConversationVoice,
} from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type {
  ConversationMessageContentReader,
  MessageContent,
} from "./content/ConversationMessageContent";
import type {
  ConversationAccount,
  ConversationAccounts,
  ConversationDirectory,
} from "./ConversationDirectory";

/** Conversations one page of the list holds at most. */
const LIST_PAGE_SIZE = 50;
/** Characters of message text one history page holds at most, so a frame stays within its limit. */
const HISTORY_PAGE_CHARACTERS = 400_000;
const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;

/** What the reads of conversations use. */
export interface ConversationReaderDependencies {
  readonly conversations: ConversationRepository;
  readonly messages: ConversationMessageRepository;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly files: Pick<WikiFileStore, "open">;
  /** The decisions about messages of groups, which the chat page shows (PAGE-317, PAGE-379). */
  readonly decisions: Pick<
    ConversationDecisionRepository,
    "forMessages" | "forReplies"
  >;
  /** The attachments and links of messages (PAGE-298). */
  readonly content: ConversationMessageContentReader;
}

/** The audio of a voice message, opened for one member. */
export interface OpenedConversationVoice {
  readonly messageId: string;
  readonly voice: ConversationVoice;
  readonly stream: ReadStream;
}

/** A conversation of the web chat page with its newest messages. */
export interface ConversationView {
  readonly summary: ConversationSummary;
  /** The newest page of the history, oldest first. */
  readonly messages: readonly ConversationMessage[];
  /** Whether older messages exist than this page holds (PAGE-275). */
  readonly hasMore: boolean;
}

/**
 * Turns a stored message into the message every client sees.
 *
 * @param stored - The stored message.
 * @param accounts - The accounts that name its sender.
 * @param content - Its attachments and links; none by default.
 * @returns The message without the name of its audio file.
 */
export function toConversationMessage(
  stored: StoredConversationMessage,
  accounts: ConversationAccounts,
  content: MessageContent = EMPTY_MESSAGE_CONTENT,
): ConversationMessage {
  const message: ConversationMessage = {
    id: stored.id,
    conversationId: stored.conversationId,
    clientMessageId: stored.clientMessageId,
    sender: accounts.participant(stored.senderId),
    text: stored.text,
    createdAt: stored.createdAt,
    mentions: stored.mentions,
    ...(stored.notice === null ? {} : { notice: stored.notice }),
    attachments: content.attachments,
    links: content.links,
  };
  if (!stored.voice) return message;
  return {
    ...message,
    voice: {
      durationMs: stored.voice.durationMs,
      transcriptionState: stored.voice.transcriptionState,
      mimeType: stored.voice.mimeType,
      sizeBytes: stored.voice.sizeBytes,
    },
  };
}

function encodeCursor(position: ConversationListPosition): string {
  return Buffer.from(
    JSON.stringify([position.lastActivityAt, position.id]),
  ).toString("base64url");
}

function decodeCursor(cursor: string | null): ConversationListPosition | null {
  if (cursor === null || cursor === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ConversationError("invalid");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  )
    throw new ConversationError("invalid");
  return { lastActivityAt: parsed[0], id: parsed[1] };
}

/** Reads a message or conversation ID; anything else is no ID of Pages. */
export function readConversationIdentifier(input: unknown): string {
  if (typeof input !== "string" || !IDENTIFIER.test(input))
    throw new ConversationError("invalid");
  return input;
}

function toContact(account: ConversationAccount): ConversationContact {
  return {
    ...account.participant,
    username: account.user.username,
    role: account.role,
  };
}

/** The newest messages within the page limits, oldest first. */
function limitPage(newestFirst: readonly StoredConversationMessage[]): {
  readonly messages: StoredConversationMessage[];
  readonly hasMore: boolean;
} {
  const messages: StoredConversationMessage[] = [];
  let characters = 0;
  for (const message of newestFirst.slice(0, CONVERSATION_HISTORY_PAGE_SIZE)) {
    characters += message.text.length;
    if (messages.length > 0 && characters > HISTORY_PAGE_CHARACTERS) break;
    messages.push(message);
  }
  return {
    messages: messages.reverse(),
    hasMore: newestFirst.length > messages.length,
  };
}

/** Whether a history read of a member also carries the decisions about its messages. */
export interface ConversationHistoryOptions {
  readonly withDecisions?: boolean;
}

/**
 * The reads of conversations for one member (PAGE-278): the list, a
 * history, the people and agents to write to, and the audio of a voice
 * message.
 *
 * @remarks
 * Every read is bound to the signed-in account: a conversation of which it
 * is no member answers `not_found`, as a missing one does, also for its
 * audio. The unread count includes muted conversations.
 */
export class ConversationReader {
  private readonly dependencies: ConversationReaderDependencies;

  public constructor(dependencies: ConversationReaderDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads a page of the person's conversations, the latest activity first. */
  public async list(
    person: User,
    cursor: string | null,
  ): Promise<ConversationListPage> {
    const after = decodeCursor(cursor);
    const records = await this.dependencies.conversations.listForMember(
      person.id,
      after,
      LIST_PAGE_SIZE + 1,
    );
    const page = records.slice(0, LIST_PAGE_SIZE);
    const last = page.at(-1);
    const [items, totalUnread] = await Promise.all([
      this.summaries(person, page),
      this.dependencies.conversations.totalUnread(person.id),
    ]);
    return {
      items,
      nextCursor:
        records.length > LIST_PAGE_SIZE && last
          ? encodeCursor({ lastActivityAt: last.lastActivityAt, id: last.id })
          : null,
      totalUnread,
    };
  }

  /**
   * Reads one conversation of the person.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member.
   */
  public async summary(
    person: User,
    conversationId: string,
  ): Promise<ConversationSummary> {
    const record = await this.requireMember(person, conversationId);
    const [summary] = await this.summaries(person, [record]);
    if (!summary) throw new ConversationError("not_found");
    return summary;
  }

  /**
   * Reads a page of a history: the newest messages, or those before a
   * message, oldest first.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `invalid` for a `beforeId` outside it.
   */
  public async history(
    person: User,
    conversationId: string,
    beforeId: string | null,
    options: ConversationHistoryOptions = {},
  ): Promise<ConversationHistoryPage> {
    await this.requireMember(person, conversationId);
    return this.historyPage(conversationId, beforeId, options);
  }

  /**
   * Reads a page of the history of a conversation of agents only for an
   * overseer who is no member (PAGE-311); the caller has checked the right.
   *
   * @throws {ConversationError} `invalid` for a `beforeId` outside the conversation.
   */
  public inspectHistory(
    conversationId: string,
    beforeId: string | null,
  ): Promise<ConversationHistoryPage> {
    return this.historyPage(conversationId, beforeId);
  }

  /**
   * Reads conversations of agents only with their newest messages for an
   * overseer who is no member (PAGE-311); the caller has checked the right.
   */
  public async inspect(
    viewer: User,
    records: readonly AgentConversationRecord[],
  ): Promise<ConversationView[]> {
    const summaries = await this.summaries(
      viewer,
      records.map((record) => ({ ...record, isMuted: false, unreadCount: 0 })),
    );
    return this.withMessages(summaries);
  }

  /** Lists the people and agents the person can start a conversation with. */
  public async contacts(person: User): Promise<ConversationContacts> {
    const accounts = (await this.dependencies.directory.read()).available(
      person.id,
    );
    return {
      people: accounts
        .filter((account) => account.participant.kind === "human")
        .map(toContact),
      agents: accounts
        .filter((account) => account.participant.kind === "agent")
        .map(toContact),
    };
  }

  /** Tells whether an account is a member of a conversation. */
  public async isMember(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    if (!IDENTIFIER.test(conversationId)) return false;
    return (
      (await this.dependencies.conversations.findForMember(
        conversationId,
        userId,
      )) !== null
    );
  }

  /** Reads the unread counts of the person after a change of the read state. */
  public async readState(
    person: User,
    conversationId: string,
    upToMessageId: string,
  ): Promise<ConversationReadState> {
    const [record, totalUnread] = await Promise.all([
      this.requireMember(person, conversationId),
      this.dependencies.conversations.totalUnread(person.id),
    ]);
    return {
      conversationId,
      upToMessageId,
      unreadCount: record.unreadCount,
      totalUnread,
    };
  }

  /**
   * Opens the audio of a voice message for a member of its conversation.
   *
   * @throws {ConversationError} `not_found` for a missing message, one
   * without audio, or one of a conversation of which the person is no member.
   */
  public async openVoice(
    person: User,
    messageId: unknown,
  ): Promise<OpenedConversationVoice> {
    const id = readConversationIdentifier(messageId);
    const stored = await this.dependencies.messages.findById(id);
    if (!stored?.voice) throw new ConversationError("not_found");
    await this.requireMember(person, stored.conversationId);
    const { voice } = stored;
    return {
      messageId: stored.id,
      voice: {
        durationMs: voice.durationMs,
        transcriptionState: voice.transcriptionState,
        mimeType: voice.mimeType,
        sizeBytes: voice.sizeBytes,
      },
      stream: this.dependencies.files.open(voice.storageName),
    };
  }

  /**
   * Reads every conversation of the person with its newest messages, for
   * the web chat page.
   */
  public async views(person: User): Promise<ConversationView[]> {
    const records = await this.dependencies.conversations.listForMember(
      person.id,
      null,
      500,
    );
    return this.withMessages(await this.summaries(person, records));
  }

  /** Returns the member IDs of a conversation. */
  public async memberIds(conversationId: string): Promise<string[]> {
    const members = await this.dependencies.conversations.memberIds([
      conversationId,
    ]);
    return members.get(conversationId) ?? [];
  }

  /**
   * Turns stored messages into the messages every client sees, with their
   * attachments and links (PAGE-298).
   *
   * @param stored - The stored messages.
   * @param accounts - The accounts that name their senders.
   */
  public async messages(
    stored: readonly StoredConversationMessage[],
    accounts: ConversationAccounts,
  ): Promise<ConversationMessage[]> {
    const content = await this.dependencies.content.describe(stored);
    return stored.map((message) =>
      toConversationMessage(message, accounts, content.get(message.id)),
    );
  }

  private async historyPage(
    conversationId: string,
    beforeId: string | null,
    options: ConversationHistoryOptions = {},
  ): Promise<ConversationHistoryPage> {
    let beforeSequence: number | null = null;
    if (beforeId !== null) {
      const before = await this.dependencies.messages.find(
        conversationId,
        readConversationIdentifier(beforeId),
      );
      if (!before) throw new ConversationError("invalid");
      beforeSequence = before.sequence;
    }
    const [stored, accounts] = await Promise.all([
      this.dependencies.messages.history(
        conversationId,
        beforeSequence,
        CONVERSATION_HISTORY_PAGE_SIZE + 1,
      ),
      this.dependencies.directory.read(),
    ]);
    const page = limitPage(stored);
    const messages = await this.messages(page.messages, accounts);
    return {
      conversationId,
      messages: options.withDecisions
        ? await this.withDecisions(messages, accounts)
        : messages,
      hasMore: page.hasMore,
    };
  }

  private async withMessages(
    summaries: readonly ConversationSummary[],
  ): Promise<ConversationView[]> {
    const accounts = await this.dependencies.directory.read();
    const views: ConversationView[] = [];
    for (const summary of summaries) {
      const stored = await this.dependencies.messages.history(
        summary.id,
        null,
        CONVERSATION_HISTORY_PAGE_SIZE + 1,
      );
      const page = limitPage(stored);
      views.push({
        summary,
        messages: await this.withDecisions(
          await this.messages(page.messages, accounts),
          accounts,
        ),
        hasMore: page.hasMore,
      });
    }
    return views;
  }

  /**
   * Adds the decisions the chat shows (PAGE-379): to the message of a person
   * that nobody answered, so the chat can say so under it, and to the answer an
   * agent gave because the decision model chose it, for its "Why?".
   */
  private async withDecisions(
    messages: readonly ConversationMessage[],
    accounts: ConversationAccounts,
  ): Promise<ConversationMessage[]> {
    const isPerson = (message: ConversationMessage): boolean =>
      message.sender.kind === "human";
    const { decisions } = this.dependencies;
    const [aboutMessages, aboutReplies] = await Promise.all([
      decisions.forMessages(
        messages.filter(isPerson).map((message) => message.id),
      ),
      decisions.forReplies(
        messages
          .filter((message) => !isPerson(message))
          .map((message) => message.id),
      ),
    ]);
    return messages.map((message) => {
      const stored = isPerson(message)
        ? aboutMessages.get(message.id)
        : aboutReplies.get(message.id);
      if (stored === undefined) return message;
      // A person's message shows only the decision that nobody answers.
      if (isPerson(message) && stored.outcome !== "nobody") return message;
      return { ...message, decision: decisionView(stored, accounts) };
    });
  }

  private async requireMember(
    person: User,
    conversationId: string,
  ): Promise<ConversationRecord> {
    const record = await this.dependencies.conversations.findForMember(
      readConversationIdentifier(conversationId),
      person.id,
    );
    if (!record) throw new ConversationError("not_found");
    return record;
  }

  private async summaries(
    person: User,
    records: readonly ConversationRecord[],
  ): Promise<ConversationSummary[]> {
    const ids = records.map((record) => record.id);
    const [members, latest, accounts] = await Promise.all([
      this.dependencies.conversations.memberIds(ids),
      this.dependencies.messages.latest(ids),
      this.dependencies.directory.read(),
    ]);
    const lastMessages = new Map(
      (await this.messages([...latest.values()], accounts)).map((message) => [
        message.conversationId,
        message,
      ]),
    );
    return records.map((record) => {
      const memberIds = members.get(record.id) ?? [];
      const other = memberIds.find((id) => id !== person.id) ?? person.id;
      return {
        id: record.id,
        kind: record.kind,
        name:
          record.kind === "group"
            ? record.name
            : accounts.participant(other).name,
        members: memberIds.map((id) => accounts.participant(id)),
        lastMessage: lastMessages.get(record.id) ?? null,
        lastActivityAt: record.lastActivityAt,
        unreadCount: record.unreadCount,
        isMuted: record.isMuted,
      };
    });
  }
}
