import { logCaughtError } from "@/backend/logging/Logger";
import {
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_MAXIMUM_CHAT_FRAME_LENGTH,
} from "@/definition/PicaMobileProtocol";

import { encodePicaMobileChat } from "../PicaMobileMessages";

import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type { PicaMobileChatClientMessage } from "../PicaMobileMessages";
import type { PicaMobileNotificationHost } from "../notifications/PicaMobileNotificationHandler";
import type { PicaMobileChatProvider } from "./PicaMobileChatProvider";

const COMPONENT = "PicaMobileChatHandler";

/**
 * Answers the requests of `chat.v1` for one connection.
 *
 * @remarks
 * Without a provider the eight requests are unknown. They need an
 * authenticated connection; the provider checks the session again for every
 * request and ends the connection when it no longer holds. Pages sends
 * nothing of the chat on its own, every frame answers one request.
 */
export class PicaMobileChatHandler {
  private readonly provider: PicaMobileChatProvider | undefined;
  private readonly host: PicaMobileNotificationHost;
  private readonly origin: string | null;

  /**
   * Creates the handler.
   *
   * @param provider - The business answers; none: the requests are unknown.
   * @param host - The connection the handler answers on.
   * @param origin - `http://<Host>` of the handshake, `null` without a valid host.
   */
  public constructor(
    provider: PicaMobileChatProvider | undefined,
    host: PicaMobileNotificationHost,
    origin: string | null,
  ) {
    this.provider = provider;
    this.host = host;
    this.origin = origin;
  }

  /**
   * Handles one request of `chat.v1`.
   *
   * @param message - A request that passed every check of its payload.
   */
  public async handle(message: PicaMobileChatClientMessage): Promise<void> {
    const { host, provider } = this;

    // A request queued behind a message that ended the connection is moot.
    if (!host.isOpen()) {
      return;
    }

    if (provider === undefined) {
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
      await this.answer(provider, message, session);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      host.reportFailure(message.requestId, error);
    }
  }

  private async answer(
    provider: PicaMobileChatProvider,
    message: PicaMobileChatClientMessage,
    session: PicaMobileSessionIdentity,
  ): Promise<void> {
    const { host } = this;
    const outcome = await provider.answer(
      { session, origin: this.origin },
      message,
    );

    if (!host.isOpen()) {
      return;
    }

    if (outcome.kind === "sessionEnded") {
      host.endSession(message.requestId);

      return;
    }

    const frame =
      outcome.kind === "answer"
        ? encodePicaMobileChat(message.requestId, outcome.answer)
        : null;

    if (
      frame === null ||
      frame.length > PICA_MOBILE_MAXIMUM_CHAT_FRAME_LENGTH
    ) {
      host.reject({
        code: PICA_MOBILE_ERROR_CODE.SERVER_UNAVAILABLE,
        message: "Pages cannot answer this chat request.",
        requestId: message.requestId,
      });

      return;
    }

    host.acknowledge();
    host.send(frame);
  }
}
