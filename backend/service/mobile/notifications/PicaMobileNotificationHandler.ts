import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_ERROR_CODE } from "@/definition/PicaMobileProtocol";

import {
  encodePicaMobileNotificationEvent,
  encodePicaMobileNotificationRegistered,
  encodePicaMobileNotificationSettings,
  encodePicaMobileNotificationUnregistered,
} from "./PicaMobileNotificationMessages";

import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type { PicaMobileRejection } from "../PicaMobileMessages";
import type { PicaMobileNotificationClientMessage } from "./PicaMobileNotificationMessages";
import type {
  PicaMobileNotificationProvider,
  PicaMobileSettingsOutcome,
} from "./PicaMobileNotificationProvider";

/** What the handler needs from the connection it works for. */
export interface PicaMobileNotificationHost {
  /** The account and session of the connection; `null` before authentication. */
  session(): PicaMobileSessionIdentity | null;
  /** Whether the connection still accepts answers. */
  isOpen(): boolean;
  /** Hands a frame to the socket; `false` when that failed. */
  send(frame: string): boolean;
  reject(rejection: PicaMobileRejection): void;
  rejectUnauthenticated(requestId: string): void;
  /** Notes a successful answer, which resets the count of rejections in a row. */
  acknowledge(): void;
  endSession(requestId: string): void;
  reportFailure(requestId: string, error: unknown): void;
}

const COMPONENT = "PicaMobileNotificationHandler";

/**
 * Answers the messages of `notifications.v1` for one connection.
 *
 * @remarks
 * Without a provider the notification messages are unknown. They need an
 * authenticated connection, and every answer is derived from the account the
 * session belongs to right now, never from the message.
 */
export class PicaMobileNotificationHandler {
  private readonly provider: PicaMobileNotificationProvider | undefined;
  private readonly host: PicaMobileNotificationHost;

  /**
   * Creates the handler.
   *
   * @param provider - The business answers; none: the messages are unknown.
   * @param host - The connection the handler answers on.
   */
  public constructor(
    provider: PicaMobileNotificationProvider | undefined,
    host: PicaMobileNotificationHost,
  ) {
    this.provider = provider;
    this.host = host;
  }

  /**
   * Handles one notification message.
   *
   * @param message - A message that passed every check of its payload.
   */
  public async handle(
    message: PicaMobileNotificationClientMessage,
  ): Promise<void> {
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
      await this.answer(provider, session, message);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      host.reportFailure(message.requestId, error);
    }
  }

  private async answer(
    provider: PicaMobileNotificationProvider,
    session: PicaMobileSessionIdentity,
    message: PicaMobileNotificationClientMessage,
  ): Promise<void> {
    if (
      message.type === "notification_settings_get" ||
      message.type === "notification_settings_set"
    ) {
      this.answerSettings(
        message.requestId,
        message.type === "notification_settings_get"
          ? await provider.readSettings(session)
          : await provider.changeSettings(session, message.payload),
      );
    } else if (message.type === "notification_register") {
      await this.answerRegister(provider, session, message);
    } else if (message.type === "notification_unregister") {
      const outcome = await provider.unregister(
        session,
        message.payload.deviceId,
      );

      if (!this.host.isOpen()) {
        return;
      }

      if (outcome.kind === "sessionEnded") {
        this.host.endSession(message.requestId);

        return;
      }

      this.host.acknowledge();
      this.host.send(
        encodePicaMobileNotificationUnregistered(message.requestId, {
          deviceId: message.payload.deviceId,
        }),
      );
    } else {
      const outcome = await provider.readEvent(
        session,
        message.payload.eventId,
      );

      if (!this.host.isOpen()) {
        return;
      }

      if (outcome.kind === "sessionEnded") {
        this.host.endSession(message.requestId);

        return;
      }

      this.host.acknowledge();
      this.host.send(
        encodePicaMobileNotificationEvent(message.requestId, outcome.payload),
      );
    }
  }

  private async answerRegister(
    provider: PicaMobileNotificationProvider,
    session: PicaMobileSessionIdentity,
    message: Extract<
      PicaMobileNotificationClientMessage,
      { readonly type: "notification_register" }
    >,
  ): Promise<void> {
    const outcome = await provider.register(session, message.payload);

    // A connection that ended meanwhile never saw the answer, so delivery must not start.
    if (!this.host.isOpen()) {
      return;
    }

    if (outcome.kind === "sessionEnded") {
      this.host.endSession(message.requestId);

      return;
    }

    if (outcome.kind === "pushUnavailable") {
      this.host.reject({
        code: PICA_MOBILE_ERROR_CODE.SERVER_UNAVAILABLE,
        message: "This server has no push service configured.",
        requestId: message.requestId,
      });

      return;
    }

    this.host.acknowledge();

    if (
      this.host.send(
        encodePicaMobileNotificationRegistered(
          message.requestId,
          outcome.payload,
        ),
      )
    ) {
      await this.activate(outcome.activate);
    }
  }

  private answerSettings(
    requestId: string,
    outcome: PicaMobileSettingsOutcome,
  ): void {
    if (!this.host.isOpen()) {
      return;
    }

    if (outcome.kind === "sessionEnded") {
      this.host.endSession(requestId);

      return;
    }

    if (outcome.kind === "pushUnavailable") {
      this.host.reject({
        code: PICA_MOBILE_ERROR_CODE.SERVER_UNAVAILABLE,
        message: "This server has no push service configured.",
        requestId,
      });

      return;
    }

    this.host.acknowledge();
    this.host.send(
      encodePicaMobileNotificationSettings(requestId, outcome.payload),
    );
  }

  /** The answer is out; a failure to start delivery is retried by the next registration. */
  private async activate(start: () => Promise<void>): Promise<void> {
    try {
      await start();
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
  }
}
