import { logCaughtError } from "@/backend/logging/Logger";
import {
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_MAXIMUM_CHAT_FRAME_LENGTH,
} from "@/definition/PicaMobileProtocol";

import { encodePicaMobileConversation } from "../PicaMobileMessages";
import { PicaMobileVoiceUploads } from "./PicaMobileVoiceUploads";

import type { ConversationEvent } from "@/backend/service/conversation/ConversationEvents";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type { PicaMobileConversationClientMessage } from "../PicaMobileMessages";
import type { PicaMobilePlansHost } from "../plans/PicaMobilePlansHandler";
import type { PicaMobileConversationPresence } from "./PicaMobileConversationPresence";
import type {
  PicaMobileConversationOutcome,
  PicaMobileConversationQuery,
  PicaMobileConversationsProvider,
} from "./PicaMobileConversationsProvider";
import type { PicaMobileVoiceMessage } from "./PicaMobileVoiceUploads";

/** What the handler is created with besides its provider and connection. */
export interface PicaMobileConversationsHandlerOptions {
  readonly connectionId: string;
  readonly presence: Pick<PicaMobileConversationPresence, "set">;
}

const COMPONENT = "PicaMobileConversationsHandler";

function isVoiceMessage(
  message: PicaMobileConversationClientMessage,
): message is PicaMobileVoiceMessage {
  return message.type.startsWith("voice_");
}

/**
 * The conversation a request leaves open on the connection: `null` for the
 * list, `undefined` when the request changes nothing.
 */
function openedConversation(
  request: PicaMobileConversationQuery,
): string | null | undefined {
  switch (request.type) {
    case "conversations_list":
      return null;
    case "conversation_history":
      return request.payload.beforeId
        ? undefined
        : request.payload.conversationId;
    case "conversation_send":
    case "conversation_read":
      return request.payload.conversationId;
    case "conversation_participants":
    case "conversation_create":
    case "conversation_mute":
      return undefined;
  }
}

/**
 * Answers `conversations.v1` for one connection and sends it the changes of
 * its account's conversations (PAGE-278).
 *
 * @remarks
 * Without a provider every request is unknown. The requests need an
 * authenticated connection; the provider checks the session again for every
 * request and ends the connection when it no longer holds. After the
 * authentication the connection receives a `conversation_event` for every
 * change of a conversation of its account, except the changes it made
 * itself, which it receives as the answers to its requests. The
 * conversation it shows counts as open, so its new messages send no push.
 */
export class PicaMobileConversationsHandler {
  private readonly provider: PicaMobileConversationsProvider | undefined;
  private readonly host: PicaMobilePlansHost;
  private readonly options: PicaMobileConversationsHandlerOptions;
  private readonly uploads: PicaMobileVoiceUploads | null;
  private stopFollowing: (() => void) | null = null;
  private isStopped = false;

  /**
   * Creates the handler.
   *
   * @param provider - The business answers; none: the requests are unknown.
   * @param host - The connection the handler answers on.
   * @param options - The connection's ID and the presence it reports to.
   */
  public constructor(
    provider: PicaMobileConversationsProvider | undefined,
    host: PicaMobilePlansHost,
    options: PicaMobileConversationsHandlerOptions,
  ) {
    this.provider = provider;
    this.host = host;
    this.options = options;
    this.uploads =
      provider === undefined
        ? null
        : new PicaMobileVoiceUploads(provider, host, options.connectionId);
  }

  /**
   * Starts sending the changes of the account's conversations; called once
   * after the authentication.
   */
  public start(): void {
    const { provider } = this;
    if (provider === undefined || this.isStopped || this.stopFollowing) return;
    this.stopFollowing = provider.follow((event) => this.receive(event));
  }

  /** Stops the events, drops unfinished uploads and closes the open conversation. */
  public stop(): void {
    this.isStopped = true;
    this.stopFollowing?.();
    this.stopFollowing = null;
    this.uploads?.stop();
    const session = this.host.session();
    if (session !== null)
      this.options.presence.set(
        session.userId,
        this.options.connectionId,
        null,
      );
  }

  /**
   * Handles one request of `conversations.v1`.
   *
   * @param message - A request that passed every check of its payload.
   */
  public async handle(
    message: PicaMobileConversationClientMessage,
  ): Promise<void> {
    const { host, provider, uploads } = this;

    // A request queued behind a message that ended the connection is moot.
    if (!host.isOpen()) return;

    if (provider === undefined || uploads === null) {
      host.reject({
        code: PICA_MOBILE_ERROR_CODE.UNKNOWN_TYPE,
        message: "The message type is not known.",
        requestId: message.requestId,
      });
      return;
    }

    const session = host.session();

    if (session === null) {
      host.rejectUnauthenticated(message.requestId);
      return;
    }

    try {
      await (isVoiceMessage(message)
        ? uploads.handle(message, session)
        : this.answer(provider, message, session));
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      host.reportFailure(message.requestId, error);
    }
  }

  private async answer(
    provider: PicaMobileConversationsProvider,
    message: Exclude<
      PicaMobileConversationClientMessage,
      PicaMobileVoiceMessage
    >,
    session: PicaMobileSessionIdentity,
  ): Promise<void> {
    const outcome = await provider.answer(
      { session, originId: this.options.connectionId },
      message,
    );

    if (!this.host.isOpen()) return;

    if (outcome.kind === "sessionEnded") {
      this.host.endSession(message.requestId);
      return;
    }

    if (outcome.answer.type !== "conversation_error")
      this.notePresence(session, openedConversation(message));
    this.deliver(message.requestId, outcome);
  }

  private notePresence(
    session: PicaMobileSessionIdentity,
    conversationId: string | null | undefined,
  ): void {
    if (conversationId === undefined) return;
    this.options.presence.set(
      session.userId,
      this.options.connectionId,
      conversationId,
    );
  }

  private deliver(
    requestId: string,
    outcome: Extract<PicaMobileConversationOutcome, { kind: "answer" }>,
  ): void {
    const frame = encodePicaMobileConversation(requestId, outcome.answer);

    if (frame.length > PICA_MOBILE_MAXIMUM_CHAT_FRAME_LENGTH) {
      this.host.reject({
        code: PICA_MOBILE_ERROR_CODE.SERVER_UNAVAILABLE,
        message: "Pages cannot answer this conversation request.",
        requestId,
      });
      return;
    }

    this.host.acknowledge();
    this.host.send(frame);
  }

  /** Queues the event of a change for the account of this connection. */
  private receive(event: ConversationEvent): void {
    const session = this.host.session();
    if (
      this.isStopped ||
      session === null ||
      event.originId === this.options.connectionId ||
      !event.recipientIds.includes(session.userId)
    )
      return;
    this.host.enqueue(() => this.send(session, event));
  }

  private async send(
    session: PicaMobileSessionIdentity,
    event: ConversationEvent,
  ): Promise<void> {
    const { provider } = this;
    if (provider === undefined || this.isStopped || !this.host.isOpen()) return;
    const payload = await provider.describe(session, event);
    if (this.isStopped || !this.host.isOpen() || payload === null) return;
    if (payload === "sessionEnded") {
      this.host.endSession(null);
      return;
    }
    const frame = encodePicaMobileConversation(null, {
      type: "conversation_event",
      payload,
    });
    if (frame.length <= PICA_MOBILE_MAXIMUM_CHAT_FRAME_LENGTH)
      this.host.send(frame);
  }
}
