import { randomUUID } from "node:crypto";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  CONVERSATION_GROUP_MAXIMUM_MEMBERS,
  CONVERSATION_NAME_MAXIMUM_LENGTH,
  CONVERSATION_TEXT_MAXIMUM_LENGTH,
} from "@/definition/Conversation";

import {
  readConversationIdentifier,
  toConversationMessage,
} from "./ConversationReader";

import type {
  ConversationMessageRepository,
  StoredConversationMessage,
} from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type {
  ConversationKind,
  ConversationMessage,
  ConversationReadState,
  ConversationSummary,
} from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type {
  ConversationAccounts,
  ConversationDirectory,
} from "./ConversationDirectory";
import type { ConversationEvents } from "./ConversationEvents";
import type { ConversationReader } from "./ConversationReader";
import type { ConversationTranscriber } from "./ConversationTranscriber";
import type {
  ConversationVoiceDeclaration,
  ConversationVoiceIntent,
  ConversationVoiceStore,
  StoredConversationVoiceFile,
} from "./ConversationVoiceStore";

/** What the writes of conversations use. */
export interface ConversationServiceDependencies {
  readonly conversations: ConversationRepository;
  readonly messages: ConversationMessageRepository;
  readonly reader: Pick<
    ConversationReader,
    "summary" | "readState" | "memberIds"
  >;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly voices: ConversationVoiceStore;
  /** Opens stored audio for the recognition. */
  readonly files: Pick<WikiFileStore, "open">;
  readonly transcriber: ConversationTranscriber;
  /** The in-process channel the Pica Mobile connections and the push follow. */
  readonly events: Pick<ConversationEvents, "publish">;
  /** Tells the live view of this process about a committed change. */
  readonly publisher: { publish(event: PagesEvent): void };
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/** Who caused a change; the Pica Mobile connection receives its own answer instead of the event. */
export interface ConversationChangeOptions {
  readonly originId?: string;
}

/** The raw input of a new conversation. */
export interface ConversationCreation {
  readonly kind: ConversationKind;
  readonly participantIds: readonly string[];
  readonly name?: string | null;
}

/** The raw input of a message. */
export interface ConversationSending {
  readonly conversationId: string;
  readonly clientMessageId: unknown;
  readonly text: unknown;
}

/** A voice message announced for a conversation, whose audio has yet to arrive. */
export interface ConversationVoiceTicket {
  readonly conversationId: string;
  readonly clientMessageId: string;
  readonly intent: ConversationVoiceIntent;
}

/** A group of the web chat page that becomes a shared conversation. */
export interface ConversationGroupAdoption {
  readonly id: string;
  readonly name: string;
  readonly memberIds: readonly string[];
}

const MENTION = /(?<![\w@])@([A-Za-z0-9._-]{1,100})/gu;

function changedEvent(conversationId: string): PagesEvent {
  return { type: "conversation.changed", id: conversationId };
}

function readText(input: unknown): string {
  if (typeof input !== "string") throw new ConversationError("invalid");
  const text = input.trim();
  if (text === "") throw new ConversationError("invalid");
  if (Array.from(text).length > CONVERSATION_TEXT_MAXIMUM_LENGTH)
    throw new ConversationError("too_long");
  return text;
}

function readGroupName(input: string | null | undefined): string {
  const name = (input ?? "").trim();
  if (name === "" || Array.from(name).length > CONVERSATION_NAME_MAXIMUM_LENGTH)
    throw new ConversationError("invalid");
  return name;
}

/** The members a text names with `@username`, never the sender. */
function findMentions(
  text: string,
  memberIds: readonly string[],
  context: {
    readonly accounts: ConversationAccounts;
    readonly senderId: string;
  },
): string[] {
  const byUsername = new Map(
    memberIds
      .filter((id) => id !== context.senderId)
      .flatMap((id) => {
        const account = context.accounts.find(id);
        return account
          ? [[account.user.username.toLowerCase(), id] as const]
          : [];
      }),
  );
  const mentioned = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    const id = byUsername.get((match[1] ?? "").toLowerCase());
    if (id !== undefined) mentioned.add(id);
  }
  return [...mentioned];
}

/**
 * The writes of conversations (PAGE-278): new direct conversations and
 * groups, messages and voice messages, the read state and muting.
 *
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
   *
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
    const name = readGroupName(creation.name);
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
   *
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
   *
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
          name: readGroupName(group.name),
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
      changedEvent(id),
    );
    this.announce(id, {
      kind: "conversation",
      recipientIds: [...known, ...added],
    });
  }

  /**
   * Sends a text message; the same `clientMessageId` returns the stored one.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `invalid` for an empty text, `too_long` beyond
   * 16,000 characters, `forbidden` for a direct conversation whose other
   * participant can no longer be written to.
   */
  public async send(
    person: User,
    sending: ConversationSending,
    options: ConversationChangeOptions = {},
  ): Promise<ConversationMessage> {
    const text = readText(sending.text);
    const clientMessageId = readConversationIdentifier(sending.clientMessageId);
    const context = await this.writable(person, sending.conversationId);
    return this.insert(person, {
      context,
      clientMessageId,
      text,
      voice: null,
      options,
    });
  }

  /**
   * Checks an announced voice message before its audio arrives.
   *
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
   *
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
   *
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
   * Marks a conversation as read up to a message.
   *
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
   *
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
        mentions: findMentions(message.text, memberIds, {
          accounts,
          senderId: person.id,
        }),
        createdAt: this.now(),
        voice: message.voice
          ? { ...message.voice, transcriptionState: "pending" }
          : null,
      },
      changedEvent(summary.id),
    );
    if (!outcome.isNew && message.voice)
      await this.dependencies.voices.discard(message.voice);
    const sent = toConversationMessage(outcome.message, accounts);
    if (!outcome.isNew) return sent;
    this.announce(summary.id, {
      kind: "message",
      message: sent,
      recipientIds: memberIds,
      originId: message.options.originId,
    });
    if (outcome.message.voice) this.transcribeLater(outcome.message, memberIds);
    return sent;
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
      changedEvent(conversation.id),
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
        }
      | {
          readonly kind: "conversation";
          readonly recipientIds: readonly string[];
          readonly originId?: string;
        },
  ): void {
    this.dependencies.publisher.publish(changedEvent(conversationId));
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
    const { voice } = stored;
    if (!voice) return;
    const outcome = await this.dependencies.transcriber.transcribe({
      open: () => this.dependencies.files.open(voice.storageName),
      mimeType: voice.mimeType,
      sizeBytes: voice.sizeBytes,
    });
    const updated = await this.dependencies.messages.completeTranscription(
      stored.id,
      outcome.ok
        ? {
            state: "done",
            text: Array.from(outcome.text.trim())
              .slice(0, CONVERSATION_TEXT_MAXIMUM_LENGTH)
              .join(""),
          }
        : { state: "failed", text: "" },
      changedEvent(stored.conversationId),
    );
    if (!updated) return;
    const accounts = await this.dependencies.directory.read();
    this.announce(stored.conversationId, {
      kind: "message_updated",
      message: toConversationMessage(updated, accounts),
      recipientIds: memberIds,
    });
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }

  private createId(): string {
    return this.dependencies.createId?.() ?? randomUUID();
  }
}
