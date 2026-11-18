import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type {
  ConversationServiceDependencies,
  ConversationChangeOptions,
  ConversationCreation,
  ConversationSending,
  ConversationVoiceTicket,
  ConversationGroupAdoption,
} from "./ConversationServiceContracts";
import { randomUUID } from "node:crypto";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  CONVERSATION_GROUP_MAXIMUM_MEMBERS,
  CONVERSATION_TEXT_MAXIMUM_LENGTH,
} from "@/definition/Conversation";

import { findConversationMentions } from "./ConversationMentions";
import {
  readConversationIdentifier,
  toConversationMessage,
} from "./ConversationReader";
import {
  conversationChangedEvent,
  readConversationGroupName,
  readMessageAttachmentIds,
  readMessageText,
  transcribeConversationVoice,
} from "./ConversationServiceHelpers";

import type {
  StoredConversationMessage,
  StoredMessageOutcome,
} from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationKind,
  ConversationMessage,
  ConversationReadState,
  ConversationSummary,
} from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type { ConversationAccounts } from "./ConversationDirectory";
import type {
  ConversationVoiceDeclaration,
  StoredConversationVoiceFile,
} from "./ConversationVoiceStore";

/** The start of the `clientMessageId` of a system line. */
export const SYSTEM_LINE_PREFIX = "session-event:";

export type {
  ConversationServiceDependencies,
  ConversationChangeOptions,
  ConversationCreation,
  ConversationSending,
  ConversationVoiceTicket,
  ConversationGroupAdoption,
} from "./ConversationServiceContracts";

/**
 * The writes of conversations: new direct conversations and
 * groups, messages and voice messages, the read state and muting.
 * @remarks
 * Every write is bound to the signed-in account and checked on the server:
 * only members write, only active people and agents can be added, a text
 * has at most 16,000 characters, and the same `clientMessageId` never
 * stores a second message. Each committed change goes to the live view of
 * the web and to the in-process channel the Pica Mobile connections and the
 * push follow. The text of a voice message arrives after the sending.
 */
export class ConversationService {
  private readonly dependencies: ConversationServiceDependencies;

  public constructor(dependencies: ConversationServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Creates a direct conversation or a group, or opens the direct
   * conversation the pair already has.
   * @throws {ConversationError} `invalid` for a participant that cannot be
   * added, the own account, a direct conversation without exactly one other
   * participant, or a group without a valid name.
   */
  public async create(
    person: User,
    creation: ConversationCreation,
    options: ConversationChangeOptions = {},
  ): Promise<ConversationSummary> {
    const accounts = await this.dependencies.directory.read();
    const participantIds = [...new Set(creation.participantIds)];
    for (const id of participantIds)
      if (id === person.id || accounts.find(id)?.isAvailable !== true)
        throw new ConversationError("invalid");
    if (creation.kind === "direct") {
      const [partnerId] = participantIds;
      if (participantIds.length !== 1 || partnerId === undefined)
        throw new ConversationError("invalid");
      return this.openDirect(person, partnerId, options);
    }
    if (
      participantIds.length === 0 ||
      participantIds.length >= CONVERSATION_GROUP_MAXIMUM_MEMBERS
    )
      throw new ConversationError("invalid");
    const name = readConversationGroupName(creation.name);
    return this.store(person, {
      conversation: {
        id: this.createId(),
        kind: "group",
        name,
        directKey: null,
        memberIds: [person.id, ...participantIds],
      },
      options,
    });
  }

  /**
   * Opens the direct conversation with a person or agent, creating it on first use.
   * @throws {ConversationError} `invalid` for the own account or one that
   * cannot be written to.
   */
  public async openDirect(
    person: User,
    partnerId: string,
    options: ConversationChangeOptions = {},
  ): Promise<ConversationSummary> {
    const accounts = await this.dependencies.directory.read();
    if (partnerId === person.id || accounts.find(partnerId) === undefined)
      throw new ConversationError("invalid");
    const directKey = [person.id, partnerId].sort().join(":");
    const existing =
      await this.dependencies.conversations.findDirect(directKey);
    if (existing !== null)
      return this.dependencies.reader.summary(person, existing);
    if (accounts.find(partnerId)?.isAvailable !== true)
      throw new ConversationError("invalid");
    return this.store(person, {
      conversation: {
        id: this.createId(),
        kind: "direct",
        name: "",
        directKey,
        memberIds: [person.id, partnerId],
      },
      options,
    });
  }

  /**
   * Makes a group of the web chat page a conversation its members share,
   * and adds the members it gained since.
   * @throws {ConversationError} `not_found` for a conversation with the ID
   * of which the person is no member.
   */
  public async adoptGroup(
    person: User,
    group: ConversationGroupAdoption,
  ): Promise<void> {
    const { conversations } = this.dependencies;
    const id = readConversationIdentifier(group.id);
    const accounts = await this.dependencies.directory.read();
    const memberIds = [
      person.id,
      ...group.memberIds.filter((memberId) => accounts.find(memberId)),
    ];
    if (!(await conversations.exists(id))) {
      await this.store(person, {
        conversation: {
          id,
          kind: "group",
          name: readConversationGroupName(group.name),
          directKey: null,
          memberIds,
        },
        options: {},
      });
      return;
    }
    const known = await this.dependencies.reader.memberIds(id);
    if (!known.includes(person.id)) throw new ConversationError("not_found");
    const added = memberIds.filter((memberId) => !known.includes(memberId));
    if (added.length === 0) return;
    await conversations.addMembers(
      id,
      { ids: added, joinedAt: this.now() },
      conversationChangedEvent(id),
    );
    this.announce(id, {
      kind: "conversation",
      recipientIds: [...known, ...added],
    });
  }

  /**
   * Sends a text message; the same `clientMessageId` returns the stored one.
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `invalid` for an empty text without attachments
   * or for an attachment that is not an own unsent upload of this
   * conversation, `too_long` beyond 16,000 characters, `forbidden` for a
   * direct conversation whose other participant can no longer be written to.
   */
  public async send(
    person: User,
    sending: ConversationSending,
    options: ConversationChangeOptions = {},
  ): Promise<ConversationMessage> {
    const attachmentIds = readMessageAttachmentIds(sending.attachmentIds);
    const text = readMessageText(sending.text, attachmentIds.length > 0);
    const clientMessageId = readConversationIdentifier(sending.clientMessageId);
    const context = await this.writable(person, sending.conversationId);
    return this.insert(person, {
      context,
      clientMessageId,
      text,
      voice: null,
      attachmentIds,
      options,
    });
  }

  /**
   * Checks an announced voice message before its audio arrives.
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `unsupported_format`, `too_long` or `invalid` for
   * the declared audio, `forbidden` as for {@link ConversationService.send}.
   */
  public async beginVoice(
    person: User,
    declaration: ConversationVoiceDeclaration & {
      readonly conversationId: string;
      readonly clientMessageId: string;
    },
  ): Promise<ConversationVoiceTicket> {
    const clientMessageId = readConversationIdentifier(
      declaration.clientMessageId,
    );
    await this.writable(person, declaration.conversationId);
    return {
      conversationId: declaration.conversationId,
      clientMessageId,
      intent: this.dependencies.voices.declare(declaration),
    };
  }

  /**
   * Stores the audio of an announced voice message.
   * @throws {ConversationError} `too_large`, `unsupported_format` or
   * `too_long` for audio the store refuses.
   */
  public storeVoice(
    ticket: ConversationVoiceTicket,
    source: AsyncIterable<Uint8Array>,
  ): Promise<StoredConversationVoiceFile> {
    return this.dependencies.voices.store(ticket.intent, source);
  }

  /**
   * Sends a voice message with stored audio; its text follows once it is
   * recognized. Repeating its `clientMessageId` returns the stored message
   * and drops the new audio.
   * @throws {ConversationError} as {@link ConversationService.beginVoice},
   * after the stored audio was dropped.
   */
  public async sendVoice(
    person: User,
    voice: {
      readonly ticket: ConversationVoiceTicket;
      readonly file: StoredConversationVoiceFile;
    },
    options: ConversationChangeOptions = {},
  ): Promise<ConversationMessage> {
    const { ticket, file } = voice;
    try {
      const context = await this.writable(person, ticket.conversationId);
      return await this.insert(person, {
        context,
        clientMessageId: ticket.clientMessageId,
        text: "",
        voice: file,
        attachmentIds: [],
        options,
      });
    } catch (error: unknown) {
      await this.dependencies.voices.discard(file);
      throw error;
    }
  }

  /** Drops stored audio that never became a message. */
  public async discardVoice(file: StoredConversationVoiceFile): Promise<void> {
    await this.dependencies.voices.discard(file);
  }

  /**
   * Deletes an own message with its attachments and their preview images.
   * @throws {ConversationError} `not_found` for a message of a conversation
   * of which the person is no member, `forbidden` for a message of another
   * sender.
   */
  public async deleteMessage(
    person: User,
    messageId: unknown,
    options: ConversationChangeOptions = {},
  ): Promise<void> {
    const { messages, attachments } = this.dependencies;
    const stored = await messages.findById(
      readConversationIdentifier(messageId),
    );
    if (!stored) throw new ConversationError("not_found");
    const summary = await this.dependencies.reader.summary(
      person,
      stored.conversationId,
    );
    const removeFiles = await attachments.collect(stored.id);
    const removed = await messages.remove(
      { id: stored.id, senderId: person.id },
      conversationChangedEvent(summary.id),
    );
    if (!removed) throw new ConversationError("forbidden");
    await removeFiles();
    if (removed.voice) await this.dependencies.voices.discard(removed.voice);
    this.announce(summary.id, {
      kind: "conversation",
      recipientIds: summary.members.map((member) => member.id),
      originId: options.originId,
    });
  }

  /**
   * Marks a conversation as read up to a message.
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `invalid` for a message outside it.
   */
  public async markRead(
    person: User,
    target: { readonly conversationId: string; readonly upToMessageId: string },
    options: ConversationChangeOptions = {},
  ): Promise<ConversationReadState> {
    const conversationId = readConversationIdentifier(target.conversationId);
    await this.dependencies.reader.summary(person, conversationId);
    const message = await this.dependencies.messages.find(
      conversationId,
      readConversationIdentifier(target.upToMessageId),
    );
    if (!message) throw new ConversationError("invalid");
    await this.dependencies.conversations.markRead(
      conversationId,
      person.id,
      message.sequence,
    );
    this.dependencies.events.publish({
      kind: "read",
      conversationId,
      upToMessageId: message.id,
      recipientIds: [person.id],
      originId: options.originId,
    });
    return this.dependencies.reader.readState(
      person,
      conversationId,
      message.id,
    );
  }

  /**
   * Mutes or unmutes a conversation for the person alone.
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member.
   */
  public async setMuted(
    person: User,
    target: { readonly conversationId: string; readonly isMuted: boolean },
    options: ConversationChangeOptions = {},
  ): Promise<ConversationSummary> {
    const conversationId = readConversationIdentifier(target.conversationId);
    await this.dependencies.reader.summary(person, conversationId);
    await this.dependencies.conversations.setMuted(
      conversationId,
      person.id,
      target.isMuted,
    );
    this.dependencies.events.publish({
      kind: "conversation",
      conversationId,
      recipientIds: [person.id],
      originId: options.originId,
    });
    return this.dependencies.reader.summary(person, conversationId);
  }

  /**
   * Stores a system line of a chat in the name of the person who caused it
   * A changed model, a restarted or compacted session, a removed
   * member. Every member sees it; it asks no agent for an answer.
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member.
   */
  public async postSystemLine(
    person: User,
    line: { readonly conversationId: string; readonly text: string },
  ): Promise<void> {
    const [summary, accounts] = await Promise.all([
      this.dependencies.reader.summary(person, line.conversationId),
      this.dependencies.directory.read(),
    ]);
    const memberIds = summary.members.map((member) => member.id);
    const outcome = await this.dependencies.messages.insert(
      {
        id: this.createId(),
        conversationId: summary.id,
        senderId: person.id,
        clientMessageId: `${SYSTEM_LINE_PREFIX}${this.createId()}`,
        text: Array.from(line.text)
          .slice(0, CONVERSATION_TEXT_MAXIMUM_LENGTH)
          .join(""),
        mentions: [],
        createdAt: this.now(),
        voice: null,
        notice: "session_event",
      },
      conversationChangedEvent(summary.id),
    );
    const [sent] = await this.dependencies.reader.messages(
      [outcome.message],
      accounts,
    );
    if (!sent) return;
    this.announce(summary.id, {
      kind: "message",
      message: sent,
      recipientIds: memberIds,
    });
  }

  /**
   * Removes a member from a group; the caller checked that the
   * person created it. The removed member no longer sees the group.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `invalid` for the person themselves or a direct
   * conversation.
   */
  public async removeMember(
    person: User,
    target: { readonly conversationId: string; readonly memberId: string },
  ): Promise<void> {
    const conversationId = readConversationIdentifier(target.conversationId);
    const summary = await this.dependencies.reader.summary(
      person,
      conversationId,
    );
    if (summary.kind !== "group" || target.memberId === person.id)
      throw new ConversationError("invalid");
    const recipientIds = summary.members.map((member) => member.id);
    if (!recipientIds.includes(target.memberId)) return;
    await this.dependencies.conversations.removeMember(
      conversationId,
      target.memberId,
      conversationChangedEvent(conversationId),
    );
    this.announce(conversationId, { kind: "conversation", recipientIds });
  }

  /**
   * Deletes a group for good with its history, attachments, preview images,
   * voice messages and decisions; there is no archive. The caller
   * checked that the person created it.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `invalid` for a direct conversation.
   */
  public async removeGroup(
    person: User,
    conversationId: string,
  ): Promise<void> {
    const id = readConversationIdentifier(conversationId);
    const summary = await this.dependencies.reader.summary(person, id);
    if (summary.kind !== "group") throw new ConversationError("invalid");
    const recipientIds = summary.members.map((member) => member.id);
    const removeAttachments =
      await this.dependencies.attachments.collectConversation(id);
    const voices = await this.dependencies.conversations.remove(
      id,
      conversationChangedEvent(id),
    );
    await removeAttachments();
    if (voices.length > 0) await this.dependencies.files.remove(voices);
    this.announce(id, { kind: "conversation", recipientIds });
  }

  /** The members of a conversation the person may write to, with the accounts that name them. */
  private async writable(
    person: User,
    conversationId: string,
  ): Promise<{
    readonly summary: ConversationSummary;
    readonly accounts: ConversationAccounts;
  }> {
    const [summary, accounts] = await Promise.all([
      this.dependencies.reader.summary(person, conversationId),
      this.dependencies.directory.read(),
    ]);
    const other = summary.members.find((member) => member.id !== person.id);
    if (
      summary.kind === "direct" &&
      other !== undefined &&
      accounts.find(other.id)?.isAvailable !== true
    )
      throw new ConversationError("forbidden");
    return { summary, accounts };
  }

  private async insert(
    person: User,
    message: {
      readonly context: {
        readonly summary: ConversationSummary;
        readonly accounts: ConversationAccounts;
      };
      readonly clientMessageId: string;
      readonly text: string;
      readonly voice: StoredConversationVoiceFile | null;
      readonly attachmentIds: readonly string[];
      readonly options: ConversationChangeOptions;
    },
  ): Promise<ConversationMessage> {
    const { summary, accounts } = message.context;
    const memberIds = summary.members.map((member) => member.id);
    const outcome = await this.dependencies.messages.insert(
      {
        id: this.createId(),
        conversationId: summary.id,
        senderId: person.id,
        clientMessageId: message.clientMessageId,
        text: message.text,
        mentions: findConversationMentions(message.text, memberIds, {
          accounts,
          senderId: person.id,
        }),
        createdAt: this.now(),
        voice: message.voice
          ? { ...message.voice, transcriptionState: "pending" }
          : null,
      },
      conversationChangedEvent(summary.id),
    );
    // The message is committed and accepted. Binding its files and announcing
    // it to the agents must not depend on the browser that sent it: a person
    // who leaves the page or closes the tab right now ends the request, and
    // the database refuses the jobs of an ended request.
    return withBackgroundDatabaseWork("conversation_message_stored", () =>
      this.completeInsert(outcome, message),
    );
  }

  /** Binds the files of a committed message, then tells the members and the agents about it. */
  private async completeInsert(
    outcome: StoredMessageOutcome,
    message: {
      readonly context: {
        readonly summary: ConversationSummary;
        readonly accounts: ConversationAccounts;
      };
      readonly voice: StoredConversationVoiceFile | null;
      readonly attachmentIds: readonly string[];
      readonly options: ConversationChangeOptions;
    },
  ): Promise<ConversationMessage> {
    const { summary, accounts } = message.context;
    const memberIds = summary.members.map((member) => member.id);
    if (!outcome.isNew && message.voice)
      await this.dependencies.voices.discard(message.voice);
    if (outcome.isNew)
      await this.bindAttachments(outcome.message, message.attachmentIds);
    const sent = await this.describeStored(outcome.message, accounts);
    if (!outcome.isNew) return sent;
    this.announce(summary.id, {
      kind: "message",
      message: sent,
      recipientIds: memberIds,
      originId: message.options.originId,
      ...(message.options.delivery === undefined
        ? {}
        : { delivery: message.options.delivery }),
    });
    if (outcome.message.voice) this.transcribeLater(outcome.message, memberIds);
    return sent;
  }

  /**
   * Turns a stored message into the message the members and the agents hear.
   * @remarks
   * Reading its attachments and links happens after the message committed. A
   * failure there must not keep the message from being announced, or it stays
   * stored and nobody answers it: a message with text is announced without
   * that content and the failure is logged with the message and its
   * conversation, never its text. A message without text lives from its
   * attachments, so there the failure is thrown.
   */
  private async describeStored(
    stored: StoredConversationMessage,
    accounts: ConversationAccounts,
  ): Promise<ConversationMessage> {
    try {
      const [described] = await this.dependencies.reader.messages(
        [stored],
        accounts,
      );
      if (!described) throw new Error("The stored message is missing.");
      return described;
    } catch (error: unknown) {
      logEvent({
        level: "error",
        event: "conversation.message.content_failed",
        component: "ConversationService",
        message:
          "The content of a stored message could not be read; it is announced without it.",
        metadata: {
          conversationId: stored.conversationId,
          messageId: stored.id,
        },
        error,
      });
      if (stored.text.trim() === "") throw error;
      return toConversationMessage(stored, accounts);
    }
  }

  /** Binds the uploads to a new message; a refused one takes the message back. */
  private async bindAttachments(
    stored: StoredConversationMessage,
    attachmentIds: readonly string[],
  ): Promise<void> {
    try {
      await this.dependencies.attachments.bind(stored, attachmentIds);
    } catch (error: unknown) {
      await this.dependencies.messages.remove(
        stored,
        conversationChangedEvent(stored.conversationId),
      );
      throw error;
    }
  }

  private async store(
    person: User,
    input: {
      readonly conversation: {
        readonly id: string;
        readonly kind: ConversationKind;
        readonly name: string;
        readonly directKey: string | null;
        readonly memberIds: readonly string[];
      };
      readonly options: ConversationChangeOptions;
    },
  ): Promise<ConversationSummary> {
    const { conversation } = input;
    const stored = await this.dependencies.conversations.create(
      { ...conversation, createdBy: person.id, createdAt: this.now() },
      conversationChangedEvent(conversation.id),
    );
    if (stored.isNew)
      this.announce(stored.id, {
        kind: "conversation",
        recipientIds: conversation.memberIds,
        originId: input.options.originId,
      });
    return this.dependencies.reader.summary(person, stored.id);
  }

  /** Tells the live view and the in-process listeners about a committed change. */
  private announce(
    conversationId: string,
    event:
      | {
          readonly kind: "message" | "message_updated";
          readonly message: ConversationMessage;
          readonly recipientIds: readonly string[];
          readonly originId?: string;
          readonly delivery?: ConversationDelivery;
        }
      | {
          readonly kind: "conversation";
          readonly recipientIds: readonly string[];
          readonly originId?: string;
        },
  ): void {
    this.dependencies.publisher.publish(
      conversationChangedEvent(conversationId),
    );
    this.dependencies.events.publish(
      event.kind === "conversation" ? { ...event, conversationId } : event,
    );
  }

  /** Recognizes the text of a voice message after the sending, outside the request. */
  private transcribeLater(
    stored: StoredConversationMessage,
    memberIds: readonly string[],
  ): void {
    void withBackgroundDatabaseWork("conversation_transcription", () =>
      this.transcribe(stored, memberIds),
    ).catch((error: unknown) => {
      logCaughtError("ConversationService", error);
    });
  }

  private async transcribe(
    stored: StoredConversationMessage,
    memberIds: readonly string[],
  ): Promise<void> {
    await transcribeConversationVoice(
      this.dependencies,
      stored,
      memberIds,
      (message) =>
        this.announce(stored.conversationId, {
          kind: "message_updated",
          message,
          recipientIds: memberIds,
        }),
    );
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }

  private createId(): string {
    return this.dependencies.createId?.() ?? randomUUID();
  }
}
