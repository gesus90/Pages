import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import { PicaMobileAvatars } from "../PicaMobileAvatars";
import { readCurrentSessionUser } from "../PicaMobileSessionUser";
import { PicaMobileVoiceFeed } from "./PicaMobileVoiceFeed";

import type { AuthService } from "@/backend/auth/AuthService";
import type { ConversationEvent } from "@/backend/service/conversation/ConversationEvents";
import type { ConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import type { ConversationReader } from "@/backend/service/conversation/ConversationReader";
import type {
  ConversationService,
  ConversationVoiceTicket,
} from "@/backend/service/conversation/ConversationService";
import type { StoredConversationVoiceFile } from "@/backend/service/conversation/ConversationVoiceStore";
import type {
  ConversationMessage,
  ConversationParticipant,
  ConversationSummary,
} from "@/definition/Conversation";
import type {
  PicaMobileConversationAnswer,
  PicaMobileConversationEventPayload,
} from "@/definition/PicaMobileConversations";
import type { User } from "@/definition/User";
import type { PicaMobileMemberAvatarSource } from "../PicaMobileAvatars";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type {
  PicaMobileConversationContext,
  PicaMobileConversationOutcome,
  PicaMobileConversationQuery,
  PicaMobileConversationsProvider,
  PicaMobileVoiceFileOutcome,
  PicaMobileVoiceSink,
  PicaMobileVoiceStart,
  PicaMobileVoiceStartOutcome,
} from "./PicaMobileConversationsProvider";

/** The Pages services `conversations.v1` is answered from. */
export interface PicaMobileConversationServices {
  readonly authService: Pick<AuthService, "getAuthenticatedUser">;
  readonly conversationReader: Pick<
    ConversationReader,
    | "list"
    | "history"
    | "contacts"
    | "summary"
    | "readState"
    | "openVoice"
    | "isMember"
    | "isVisibleParticipant"
  >;
  readonly conversationService: Pick<
    ConversationService,
    | "create"
    | "send"
    | "markRead"
    | "setMuted"
    | "beginVoice"
    | "storeVoice"
    | "sendVoice"
    | "discardVoice"
  >;
  /** The profile images of the members and senders of conversations. */
  readonly userService: PicaMobileMemberAvatarSource;
}

/** What the provider is built from. */
export interface PagesPicaMobileConversationsOptions {
  /**
   * Resolves the Pages services when a request needs them, so the listener
   * works before the database does.
   */
  readonly resolveServices: () => Promise<PicaMobileConversationServices>;
  /** The in-process channel of committed conversation changes. */
  readonly events: Pick<ConversationEvents, "subscribe">;
}

const COMPONENT = "PagesPicaMobileConversations";

/** Changes one member or sender as an answer shows it. */
type ParticipantChange = (
  participant: ConversationParticipant,
) => ConversationParticipant;

/** The checked payload of a `conversation_avatar_get`. */
type ConversationAvatarRequest = Extract<
  PicaMobileConversationQuery,
  { readonly type: "conversation_avatar_get" }
>["payload"];

function withAvatarVersion(
  participant: ConversationParticipant,
  versions: ReadonlyMap<string, string>,
): ConversationParticipant {
  const avatarVersion = versions.get(participant.id);
  return avatarVersion === undefined
    ? participant
    : { ...participant, avatarVersion };
}

function changeMessage(
  message: ConversationMessage,
  change: ParticipantChange,
): ConversationMessage {
  return { ...message, sender: change(message.sender) };
}

function changeSummary(
  summary: ConversationSummary,
  change: ParticipantChange,
): ConversationSummary {
  return {
    ...summary,
    members: summary.members.map(change),
    lastMessage:
      summary.lastMessage === null
        ? null
        : changeMessage(summary.lastMessage, change),
  };
}

/** Applies a change to every member and sender an event shows. */
function changeEventParticipants(
  payload: PicaMobileConversationEventPayload,
  change: ParticipantChange,
): PicaMobileConversationEventPayload {
  if (payload.type === "message" || payload.type === "message_updated")
    return { ...payload, data: changeMessage(payload.data, change) };
  if (payload.type === "conversation")
    return { ...payload, data: changeSummary(payload.data, change) };
  return payload;
}

/** Applies a change to every member and sender an answer shows. */
function changeAnswerParticipants(
  conversationAnswer: PicaMobileConversationAnswer,
  change: ParticipantChange,
): PicaMobileConversationAnswer {
  switch (conversationAnswer.type) {
    case "conversations": {
      const { payload } = conversationAnswer;
      const items = payload.items.map((item) => changeSummary(item, change));
      return { ...conversationAnswer, payload: { ...payload, items } };
    }
    case "conversation_messages": {
      const { payload } = conversationAnswer;
      const messages = payload.messages.map((message) =>
        changeMessage(message, change),
      );
      return { ...conversationAnswer, payload: { ...payload, messages } };
    }
    case "conversation_event":
      return {
        ...conversationAnswer,
        payload: changeEventParticipants(conversationAnswer.payload, change),
      };
    case "conversation_participant_list": {
      const { payload } = conversationAnswer;
      const people = payload.people.map((person) => ({
        ...person,
        ...change(person),
      }));
      const agents = payload.agents.map((agent) => ({
        ...agent,
        ...change(agent),
      }));
      return { ...conversationAnswer, payload: { ...payload, people, agents } };
    }
    case "conversation_avatar":
    case "conversation_error":
      return conversationAnswer;
  }
}

function answer(
  conversationAnswer: PicaMobileConversationAnswer,
): PicaMobileConversationOutcome {
  return { kind: "answer", answer: conversationAnswer };
}

function failure(
  id: string | null,
  error: ConversationError,
): PicaMobileConversationOutcome {
  return answer({
    type: "conversation_error",
    payload: { id, code: error.code },
  });
}

/** The conversation a request names, which a refusal repeats. */
function namedConversation(
  request: PicaMobileConversationQuery,
): string | null {
  return "conversationId" in request.payload
    ? request.payload.conversationId
    : null;
}

/**
 * Answers `conversations.v1` with the stored conversations of Pages, the
 * same ones the web chat page shows.
 * @remarks
 * Every request reads the account behind the session first and then uses
 * the same services as the web, so rights, limits and the repetition of a
 * message with the same `clientMessageId` behave alike. A
 * {@link ConversationError} becomes `conversation_error` with its code.
 * Members and senders carry the optional `avatarVersion` of their current
 * profile image, which `conversation_avatar_get` delivers only to an account
 * that reads the conversation and only for an account it shows.
 */
export class PagesPicaMobileConversations implements PicaMobileConversationsProvider {
  private readonly options: PagesPicaMobileConversationsOptions;
  private readonly avatars = new PicaMobileAvatars();

  /**
   * Creates the provider.
   * @param options - The services and the channel of committed changes.
   */
  public constructor(options: PagesPicaMobileConversationsOptions) {
    this.options = options;
  }

  /** Answers one request other than the voice upload. */
  public async answer(
    context: PicaMobileConversationContext,
    request: PicaMobileConversationQuery,
  ): Promise<PicaMobileConversationOutcome> {
    const services = await this.options.resolveServices();
    const user = await readCurrentSessionUser(
      services.authService,
      context.session,
    );
    if (user === null) return { kind: "sessionEnded" };
    try {
      return answer(
        await this.withAvatarVersions(
          services,
          await this.dispatch(services, { user, context }, request),
          changeAnswerParticipants,
        ),
      );
    } catch (error: unknown) {
      if (error instanceof ConversationError)
        return failure(namedConversation(request), error);
      throw error;
    }
  }

  /** Checks an announced voice message and opens the store for its audio. */
  public async beginVoice(
    context: PicaMobileConversationContext,
    start: PicaMobileVoiceStart,
  ): Promise<PicaMobileVoiceStartOutcome> {
    const services = await this.options.resolveServices();
    const user = await readCurrentSessionUser(
      services.authService,
      context.session,
    );
    if (user === null) return { kind: "sessionEnded" };
    let ticket: ConversationVoiceTicket;
    try {
      ticket = await services.conversationService.beginVoice(user, start);
    } catch (error: unknown) {
      if (error instanceof ConversationError)
        return { kind: "failed", code: error.code };
      throw error;
    }
    return {
      kind: "started",
      sink: this.openSink(services, { context, ticket, uploadId: start.id }),
    };
  }

  /** Opens the audio of a voice message for a member of its conversation. */
  public async openVoice(
    session: PicaMobileSessionIdentity,
    messageId: string,
  ): Promise<PicaMobileVoiceFileOutcome> {
    const services = await this.options.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);
    if (user === null) return { kind: "sessionEnded" };
    try {
      const opened = await services.conversationReader.openVoice(
        user,
        messageId,
      );
      return { kind: "opened", voice: opened.voice, stream: opened.stream };
    } catch (error: unknown) {
      if (error instanceof ConversationError) return { kind: "notFound" };
      throw error;
    }
  }

  /** Builds the event an account receives for a committed change. */
  public async describe(
    session: PicaMobileSessionIdentity,
    event: ConversationEvent,
  ): Promise<PicaMobileConversationEventPayload | null | "sessionEnded"> {
    if (event.kind === "message" || event.kind === "message_updated")
      return this.withAvatarVersions<PicaMobileConversationEventPayload>(
        await this.options.resolveServices(),
        { type: event.kind, data: event.message },
        changeEventParticipants,
      );
    // The recipients of a live part are the members who may read it.
    if (event.kind === "answer") return event.payload;
    if (event.kind === "typing")
      return {
        type: "typing",
        data: {
          conversationId: event.conversationId,
          participantId: event.participantId,
          isTyping: event.isTyping,
        },
      };
    const services = await this.options.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);
    if (user === null) return "sessionEnded";
    try {
      const payload: PicaMobileConversationEventPayload =
        event.kind === "read"
          ? {
              type: "read",
              data: await services.conversationReader.readState(
                user,
                event.conversationId,
                event.upToMessageId,
              ),
            }
          : {
              type: "conversation",
              data: await services.conversationReader.summary(
                user,
                event.conversationId,
              ),
            };
      return await this.withAvatarVersions(
        services,
        payload,
        changeEventParticipants,
      );
    } catch (error: unknown) {
      if (error instanceof ConversationError) return null;
      throw error;
    }
  }

  /** Follows the committed changes of conversations. */
  public follow(listener: (event: ConversationEvent) => void): () => void {
    return this.options.events.subscribe(listener);
  }

  private async dispatch(
    services: PicaMobileConversationServices,
    actor: {
      readonly user: User;
      readonly context: PicaMobileConversationContext;
    },
    request: PicaMobileConversationQuery,
  ): Promise<PicaMobileConversationAnswer> {
    const { conversationReader: reader, conversationService: writer } =
      services;
    const { user } = actor;
    const options = { originId: actor.context.originId };
    switch (request.type) {
      case "conversations_list":
        return {
          type: "conversations",
          payload: await reader.list(user, request.payload.cursor ?? null),
        };
      case "conversation_history":
        return {
          type: "conversation_messages",
          payload: await reader.history(
            user,
            request.payload.conversationId,
            request.payload.beforeId ?? null,
          ),
        };
      case "conversation_participants":
        return {
          type: "conversation_participant_list",
          payload: await reader.contacts(user),
        };
      case "conversation_create":
        return {
          type: "conversation_event",
          payload: {
            type: "conversation",
            data: await writer.create(user, request.payload, options),
          },
        };
      case "conversation_send":
        return {
          type: "conversation_event",
          payload: {
            type: "message",
            data: await writer.send(user, request.payload, options),
          },
        };
      case "conversation_read":
        return {
          type: "conversation_event",
          payload: {
            type: "read",
            data: await writer.markRead(user, request.payload, options),
          },
        };
      case "conversation_mute":
        return {
          type: "conversation_event",
          payload: {
            type: "conversation",
            data: await writer.setMuted(user, request.payload, options),
          },
        };
      case "conversation_avatar_get":
        return this.readMemberAvatar(services, user, request.payload);
    }
  }

  /**
   * Reads the profile image of a member or sender of a conversation of the
   * account when it still has the requested version.
   * @throws {ConversationError} `not_found` for a conversation the account
   * does not read, a missing image or another version, `forbidden` for an
   * account that is neither member nor sender of the conversation.
   */
  private async readMemberAvatar(
    services: PicaMobileConversationServices,
    user: User,
    request: ConversationAvatarRequest,
  ): Promise<PicaMobileConversationAnswer> {
    const { conversationId, userId, version } = request;
    const isVisible = await services.conversationReader.isVisibleParticipant(
      user,
      conversationId,
      userId,
    );
    if (!isVisible) throw new ConversationError("forbidden");
    const avatar = await this.avatars.ofAccount(services.userService, userId);
    if (avatar === null || avatar.version !== version)
      throw new ConversationError("not_found");
    return {
      type: "conversation_avatar",
      payload: {
        conversationId,
        userId,
        version: avatar.version,
        mimeType: avatar.mimeType,
        data: avatar.data.toString("base64"),
      },
    };
  }

  /**
   * Adds the version of the current profile image to every member and
   * sender the subject shows.
   * @remarks
   * The versions are decoration: when they cannot be read the subject stays
   * as it is, so the conversation still reaches the app.
   */
  private async withAvatarVersions<Subject>(
    services: PicaMobileConversationServices,
    subject: Subject,
    changeParticipants: (
      subject: Subject,
      change: ParticipantChange,
    ) => Subject,
  ): Promise<Subject> {
    const userIds = new Set<string>();
    // Walks the subject once only to learn which accounts it shows.
    changeParticipants(subject, (participant) => {
      userIds.add(participant.id);
      return participant;
    });
    if (userIds.size === 0) return subject;
    let versions: ReadonlyMap<string, string>;
    try {
      versions = await this.avatars.versions(services.userService, [
        ...userIds,
      ]);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      return subject;
    }
    if (versions.size === 0) return subject;
    return changeParticipants(subject, (participant) =>
      withAvatarVersion(participant, versions),
    );
  }

  /** Streams the chunks of one voice message to the store and sends it at the end. */
  private openSink(
    services: PicaMobileConversationServices,
    upload: {
      readonly context: PicaMobileConversationContext;
      readonly ticket: ConversationVoiceTicket;
      readonly uploadId: string;
    },
  ): PicaMobileVoiceSink {
    const feed = new PicaMobileVoiceFeed();
    const storing = services.conversationService.storeVoice(
      upload.ticket,
      feed,
    );
    // A cancelled or refused upload rejects here; `finish` reports what it needs.
    storing.catch((error: unknown) => {
      if (!(error instanceof ConversationError))
        logCaughtError(COMPONENT, error);
    });
    return {
      write: (chunk) => feed.push(chunk),
      cancel: () => feed.fail(new Error("The voice upload was cancelled.")),
      finish: async () => {
        feed.end();
        let file: StoredConversationVoiceFile;
        try {
          file = await storing;
        } catch (error: unknown) {
          if (error instanceof ConversationError)
            return failure(upload.uploadId, error);
          throw error;
        }
        return this.sendVoice(services, { ...upload, file });
      },
    };
  }

  private async sendVoice(
    services: PicaMobileConversationServices,
    upload: {
      readonly context: PicaMobileConversationContext;
      readonly ticket: ConversationVoiceTicket;
      readonly uploadId: string;
      readonly file: StoredConversationVoiceFile;
    },
  ): Promise<PicaMobileConversationOutcome> {
    const user = await readCurrentSessionUser(
      services.authService,
      upload.context.session,
    );
    if (user === null) {
      await services.conversationService.discardVoice(upload.file);
      return { kind: "sessionEnded" };
    }
    try {
      const message = await services.conversationService.sendVoice(
        user,
        { ticket: upload.ticket, file: upload.file },
        { originId: upload.context.originId },
      );
      return answer(
        await this.withAvatarVersions<PicaMobileConversationAnswer>(
          services,
          {
            type: "conversation_event",
            payload: { type: "message", data: message },
          },
          changeAnswerParticipants,
        ),
      );
    } catch (error: unknown) {
      if (error instanceof ConversationError)
        return failure(upload.uploadId, error);
      throw error;
    }
  }
}
