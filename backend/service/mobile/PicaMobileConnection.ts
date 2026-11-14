import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  PICA_MOBILE_AUTHENTICATION_TIMEOUT_MILLISECONDS,
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_HEARTBEAT_INTERVAL_MILLISECONDS,
  PICA_MOBILE_HEARTBEAT_TIMEOUT_MILLISECONDS,
  PICA_MOBILE_MAXIMUM_MESSAGE_BYTES,
  PICA_MOBILE_SUPPORTED_VERSIONS,
} from "@/definition/PicaMobileProtocol";
import type { PicaMobileCapability } from "@/definition/PicaMobileProtocol";

import { PicaMobileCalendarHandler } from "./calendar/PicaMobileCalendarHandler";
import { isPicaMobileCalendarMessage } from "./calendar/PicaMobileCalendarMessages";
import { PicaMobileChatHandler } from "./chat/PicaMobileChatHandler";
import { sharedPicaMobileConversationPresence } from "./conversations/PicaMobileConversationPresence";
import { PicaMobileConversationsHandler } from "./conversations/PicaMobileConversationsHandler";
import { PicaMobileNotificationHandler } from "./notifications/PicaMobileNotificationHandler";
import { PicaMobilePlansHandler } from "./plans/PicaMobilePlansHandler";
import { PicaMobileSpeechHandler } from "./speech/PicaMobileSpeechHandler";
import { isPicaMobileSpeechType } from "./speech/PicaMobileSpeechMessages";
import { PicaMobileDashboardHandler } from "./PicaMobileDashboardHandler";
import { readPicaMobileCapabilities } from "./PicaMobileCapabilities";
import {
  describePicaMobileFrameMismatch,
  PicaMobileFrameBudget,
  readPicaMobileFrameKind,
} from "./PicaMobileFrameBudget";
import {
  describePicaMobileAuthenticationFailure,
  encodePicaMobileConnected,
  encodePicaMobileError,
  encodePicaMobilePong,
  isPicaMobileConversationMessage,
  parsePicaMobileMessage,
} from "./PicaMobileMessages";

import type {
  PicaMobileAuthenticator,
  PicaMobileAuthOutcome,
  PicaMobileClientOrigin,
} from "./PicaMobileAuthenticator";
import type {
  PicaMobileDashboardProvider,
  PicaMobileSessionIdentity,
} from "./PicaMobileDashboardProvider";
import type { PicaMobileCalendarProvider } from "./calendar/PicaMobileCalendarProvider";
import type { PicaMobileSpeechClientMessage } from "./speech/PicaMobileSpeechMessages";
import type { PicaMobileSpeechProvider } from "./speech/PicaMobileSpeechProvider";
import type {
  PicaMobileChatClientMessage,
  PicaMobileClientMessage,
} from "./PicaMobileMessages";
import type { PicaMobileRejection } from "./PicaMobileMessages";
import type { PicaMobileFrameKind } from "./PicaMobileFrameBudget";
import type { PicaMobileChatProvider } from "./chat/PicaMobileChatProvider";
import type { PicaMobileConversationPresence } from "./conversations/PicaMobileConversationPresence";
import type { PicaMobileConversationsProvider } from "./conversations/PicaMobileConversationsProvider";
import type { PicaMobileNotificationProvider } from "./notifications/PicaMobileNotificationProvider";
import type { PicaMobilePlansHost } from "./plans/PicaMobilePlansHandler";
import type { PicaMobilePlansProvider } from "./plans/PicaMobilePlansProvider";

/** The operations a connection needs on its WebSocket; `ws` provides them. */
export interface PicaMobileChannel {
  send(text: string): void;
  close(code: number, reason: string): void;
  terminate(): void;
  ping(): void;
}

/** What a connection is created with. */
export interface PicaMobileConnectionOptions {
  readonly connectionId: string;
  readonly origin: PicaMobileClientOrigin;
  readonly authenticator: PicaMobileAuthenticator;
  /** Version of this Pages build, reported to a connected client. */
  readonly serverVersion: string;
  /**
   * Answers `dashboard_get` and `avatar_get`; without it the connection does
   * not announce `dashboard.v1` and treats both messages as unknown.
   */
  readonly dashboard?: PicaMobileDashboardProvider;
  /**
   * Answers the notification messages; without it the connection announces
   * neither `notifications.v1`, `notifications.push.fcm` nor `notifications.team.v1` and treats the
   * messages as unknown.
   */
  readonly notifications?: PicaMobileNotificationProvider;
  /**
   * Answers `plans_sync` and `plan_get`; without it the connection does not
   * announce `plans.v1` and treats both messages as unknown.
   */
  readonly plans?: PicaMobilePlansProvider;
  /**
   * Answers the `chat_*` requests; without it the connection announces
   * neither `chat.v1` nor `chat.delete` and treats the requests as unknown.
   */
  readonly chat?: PicaMobileChatProvider;
  /**
   * Answers the requests of `conversations.v1` and sends the changes of the
   * account's conversations; without it the connection does not announce
   * `conversations.v1` and treats the requests as unknown.
   */
  readonly conversations?: PicaMobileConversationsProvider;
  /**
   * Answers the requests of `speech.v1`; without it the connection does not
   * announce `speech.v1` and treats the requests as unknown.
   */
  readonly speech?: PicaMobileSpeechProvider;
  /** Answers `calendar.v1` and sends `calendar_changed`; without it `calendar.v1` is unknown. */
  readonly calendar?: PicaMobileCalendarProvider;
  /** Where the connection notes the conversation it shows; the process's own by default. */
  readonly presence?: Pick<PicaMobileConversationPresence, "set">;
  /**
   * `http://<Host>` of the handshake; `chat_send` protects it as the web
   * route protects its origin. Absent for a missing or invalid host.
   */
  readonly handshakeOrigin?: string;
  /** Clock in milliseconds; tests replace it. */
  readonly now?: () => number;
}

const CLOSE_GOING_AWAY = 1001;
const CLOSE_POLICY = 1008;
const CLOSE_MESSAGE_TOO_BIG = 1009;
const CLOSE_GRACE_MILLISECONDS = 2_000;
const REVALIDATION_INTERVAL_MILLISECONDS = 60_000;

const MAXIMUM_CONSECUTIVE_REJECTIONS = 5;
const MAXIMUM_FAILED_AUTHENTICATIONS = 3;
const MAXIMUM_LOGGED_REJECTIONS = 5;
const COMPONENT = "PicaMobileConnection";

/** Whether a message belongs to `chat.v1` or `chat.delete`, whose requests all start with `chat_`. */
function isChatMessage(
  message: PicaMobileClientMessage,
): message is PicaMobileChatClientMessage {
  return message.type.startsWith("chat_");
}

/** Whether a message belongs to `speech.v1`. */
function isSpeechMessage(
  message: PicaMobileClientMessage,
): message is PicaMobileSpeechClientMessage {
  return isPicaMobileSpeechType(message.type);
}

/**
 * One WebSocket connection of Pica Mobile: authentication, heartbeat and the
 * protocol rules that keep a misbehaving peer from costing the server more
 * than a closed connection.
 *
 * @remarks
 * Until an `auth` message succeeded, every other message is refused. The
 * connection is then bound to the Pages account of that authentication and
 * its session is checked again regularly, so ending the session or
 * deactivating the account ends the connection. Messages are handled one
 * after another. Credentials and tokens are never logged.
 */
export class PicaMobileConnection {
  private readonly channel: PicaMobileChannel;
  private readonly options: PicaMobileConnectionOptions;
  private readonly queue = new SerialQueue();
  private readonly notifications: PicaMobileNotificationHandler;
  private readonly plans: PicaMobilePlansHandler;
  private readonly chat: PicaMobileChatHandler;
  private readonly conversations: PicaMobileConversationsHandler;
  private readonly dashboard: PicaMobileDashboardHandler;
  private readonly speech: PicaMobileSpeechHandler;
  private readonly calendar: PicaMobileCalendarHandler;
  private readonly now: () => number;
  private session: PicaMobileSessionIdentity | null = null;
  private isStopped = false;
  private isClosing = false;
  private lastSeen: number;
  private lastValidated: number;
  private readonly budget: PicaMobileFrameBudget;
  private consecutiveRejections = 0;
  private failedAuthentications = 0;
  private loggedRejections = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private authenticationTimer: NodeJS.Timeout | null = null;
  private closeTimer: NodeJS.Timeout | null = null;

  /**
   * Creates the connection of an accepted WebSocket.
   *
   * @param channel - The WebSocket of the peer.
   * @param options - Identity, origin and collaborators of the connection.
   */
  public constructor(
    channel: PicaMobileChannel,
    options: PicaMobileConnectionOptions,
  ) {
    this.channel = channel;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.lastSeen = this.now();
    this.lastValidated = this.lastSeen;
    this.budget = new PicaMobileFrameBudget(this.now);
    const host = this.createHost();

    this.notifications = new PicaMobileNotificationHandler(
      options.notifications,
      host,
    );
    this.plans = new PicaMobilePlansHandler(options.plans, host);
    this.dashboard = new PicaMobileDashboardHandler(options.dashboard, host);
    this.speech = new PicaMobileSpeechHandler(options.speech, host);
    this.calendar = new PicaMobileCalendarHandler(options.calendar, host);
    this.chat = new PicaMobileChatHandler(
      options.chat,
      host,
      options.handshakeOrigin ?? null,
    );
    this.conversations = new PicaMobileConversationsHandler(
      options.conversations,
      host,
      {
        connectionId: options.connectionId,
        presence: options.presence ?? sharedPicaMobileConversationPresence(),
      },
    );
  }

  /** Starts the heartbeat and the time limit for the authentication. */
  public start(): void {
    this.heartbeatTimer = setInterval(
      () => this.checkHeartbeat(),
      PICA_MOBILE_HEARTBEAT_INTERVAL_MILLISECONDS,
    );
    this.heartbeatTimer.unref();
    this.authenticationTimer = setTimeout(() => {
      this.logClosing("authentication_timeout");
      this.close(CLOSE_POLICY, "Authentication timeout");
    }, PICA_MOBILE_AUTHENTICATION_TIMEOUT_MILLISECONDS);
    this.authenticationTimer.unref();
  }

  /**
   * Handles a text frame of the peer.
   *
   * @remarks
   * The socket takes frames up to the size of `chat_send`; every frame but
   * `chat_send`, `conversation_send`, `voice_chunk`, `speech_chunk` and
   * `calendar_event_save` keeps the smaller
   * limit: before authentication a larger one closes the connection, after
   * it a larger one is refused. Voice chunks count in their own budget, so
   * a recording does not use up the limit of the other messages.
   */
  public receiveText(text: string): void {
    const kind = readPicaMobileFrameKind(text, this.session !== null);

    if (!this.admit(kind)) {
      return;
    }

    const isLarge =
      Buffer.byteLength(text, "utf8") > PICA_MOBILE_MAXIMUM_MESSAGE_BYTES;

    if (isLarge && this.session === null) {
      this.logClosing("message_too_big");
      this.close(CLOSE_MESSAGE_TOO_BIG, "Message too big");

      return;
    }

    this.budget.countPending(kind, 1);
    void this.queue.run(async () => {
      try {
        await this.handleText(text, { isLarge, kind });
      } catch (error: unknown) {
        logCaughtError(COMPONENT, error);

        this.reportFailure(null, error);
      } finally {
        this.budget.countPending(kind, -1);
      }
    });
  }

  /** Handles a binary frame, which the protocol does not use. */
  public receiveBinary(): void {
    if (!this.admit("message")) {
      return;
    }

    this.reject({
      code: PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
      message: "Only text frames are supported.",
      requestId: null,
    });
  }

  /** Notes that the peer answered a WebSocket ping. */
  public receivePong(): void {
    this.lastSeen = this.now();
  }

  /**
   * Closes the connection from the server side.
   *
   * @param code - WebSocket close code.
   * @param reason - Short text for the peer.
   *
   * @remarks
   * A peer that does not complete the closing handshake is cut off after a
   * short grace period.
   */
  public close(code: number, reason: string): void {
    this.isClosing = true;

    if (this.closeTimer === null) {
      this.closeTimer = setTimeout(
        () => this.channel.terminate(),
        CLOSE_GRACE_MILLISECONDS,
      );
      this.closeTimer.unref();
    }

    this.channel.close(code, reason);
  }

  /** Closes the connection because the server stops or moves to another port. */
  public closeGoingAway(reason: string): void {
    this.close(CLOSE_GOING_AWAY, reason);
  }

  /**
   * Releases the timers once the WebSocket is closed.
   *
   * @param code - Close code the WebSocket ended with.
   */
  public stop(code: number): void {
    this.isStopped = true;
    this.plans.stop();
    this.conversations.stop();
    this.speech.stop();
    this.calendar.stop();

    for (const timer of [
      this.heartbeatTimer,
      this.authenticationTimer,
      this.closeTimer,
    ]) {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }

    this.heartbeatTimer = null;
    this.authenticationTimer = null;
    this.closeTimer = null;
    logEvent({
      level: "info",
      event: "pica_mobile.connection.closed",
      component: COMPONENT,
      message: "Pica Mobile connection closed",
      metadata: {
        code,
        ...(this.session === null ? {} : { userId: this.session.userId }),
      },
    });
  }

  /** Counts a frame; tells whether it may be handled. */
  private admit(kind: PicaMobileFrameKind): boolean {
    this.lastSeen = this.now();

    if (this.isStopped || this.isClosing) {
      return false;
    }

    if (this.budget.isOverRate(kind)) {
      this.logClosing("rate_limit");
      this.send(
        encodePicaMobileError({
          code: PICA_MOBILE_ERROR_CODE.RATE_LIMITED,
          message: "Too many messages.",
          requestId: null,
        }),
      );
      this.close(CLOSE_POLICY, "Rate limit exceeded");

      return false;
    }

    if (this.budget.isQueueFull(kind)) {
      this.logClosing("queue_limit");
      this.close(CLOSE_POLICY, "Too many pending messages");

      return false;
    }

    return true;
  }

  private async handleText(
    text: string,
    frame: { readonly isLarge: boolean; readonly kind: PicaMobileFrameKind },
  ): Promise<void> {
    const parsed = parsePicaMobileMessage(text);
    const mismatch = parsed.ok
      ? describePicaMobileFrameMismatch(parsed.message.type, frame)
      : null;

    if (!parsed.ok) {
      this.reject(parsed.rejection);
    } else if (mismatch !== null) {
      this.reject({
        code: PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
        message: mismatch,
        requestId: parsed.message.requestId,
      });
    } else {
      await this.dispatch(parsed.message);
    }
  }

  private async dispatch(message: PicaMobileClientMessage): Promise<void> {
    if (isChatMessage(message)) {
      await this.chat.handle(message);

      return;
    }

    if (isPicaMobileConversationMessage(message)) {
      await this.conversations.handle(message);

      return;
    }

    if (isSpeechMessage(message)) {
      await this.speech.handle(message);

      return;
    }

    if (isPicaMobileCalendarMessage(message)) {
      await this.calendar.handle(message);

      return;
    }
    await this.dispatchCore(message);
  }

  private async dispatchCore(
    message: Extract<
      PicaMobileClientMessage,
      {
        type:
          | "auth"
          | "ping"
          | "dashboard_get"
          | "avatar_get"
          | "notification_register"
          | "notification_unregister"
          | "notification_event_get"
          | "notification_settings_get"
          | "notification_settings_set"
          | "plans_sync"
          | "plan_get";
      }
    >,
  ): Promise<void> {
    switch (message.type) {
      case "auth":
        await this.authenticate(message);

        return;
      case "ping":
        this.answerPing(message.requestId);

        return;
      case "dashboard_get":
      case "avatar_get":
        await this.dashboard.handle(message);

        return;
      case "notification_register":
      case "notification_unregister":
      case "notification_event_get":
      case "notification_settings_get":
      case "notification_settings_set":
        await this.notifications.handle(message);

        return;
      case "plans_sync":
      case "plan_get":
        await this.plans.handle(message);
    }
  }

  /** What the handlers of the extensions use of this connection. */
  private createHost(): PicaMobilePlansHost {
    return {
      session: () => this.session,
      isOpen: () => !this.isStopped && !this.isClosing,
      send: (frame) => this.send(frame),
      reject: (rejection) => this.reject(rejection),
      rejectUnauthenticated: (requestId) =>
        this.rejectUnauthenticated(requestId),
      acknowledge: () => {
        this.consecutiveRejections = 0;
      },
      endSession: (requestId) => this.endSession(requestId),
      reportFailure: (requestId, error) => this.reportFailure(requestId, error),
      enqueue: (task) => this.enqueue(task),
    };
  }

  /** Runs work of the connection itself behind the queued messages, outside their limits. */
  private enqueue(task: () => Promise<void>): void {
    void this.queue.run(async () => {
      try {
        await task();
      } catch (error: unknown) {
        logCaughtError(COMPONENT, error);
      }
    });
  }

  private answerPing(requestId: string): void {
    if (this.session === null) {
      this.rejectUnauthenticated(requestId);

      return;
    }

    this.consecutiveRejections = 0;
    this.send(encodePicaMobilePong(requestId, new Date(this.now())));
  }

  private rejectUnauthenticated(requestId: string): void {
    this.reject({
      code: PICA_MOBILE_ERROR_CODE.AUTHENTICATION_REQUIRED,
      message: "Authenticate with an auth message first.",
      requestId,
    });
  }

  private async authenticate(
    message: Extract<PicaMobileClientMessage, { type: "auth" }>,
  ): Promise<void> {
    if (this.session !== null) {
      this.reject({
        code: PICA_MOBILE_ERROR_CODE.ALREADY_AUTHENTICATED,
        message: "This connection is already authenticated.",
        requestId: message.requestId,
      });

      return;
    }

    let outcome: PicaMobileAuthOutcome;

    try {
      outcome = await this.options.authenticator.authenticate(
        message.payload,
        this.options.origin,
      );
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      this.reportFailure(message.requestId, error);

      return;
    }

    if (this.isStopped) {
      return;
    }

    if (outcome.ok) {
      const capabilities = await readPicaMobileCapabilities(this.options, {
        userId: outcome.user.id,
        sessionToken: outcome.sessionToken,
      });

      if (!this.isStopped) {
        this.acceptAuthentication(message.requestId, outcome, capabilities);
      }
    } else {
      this.rejectAuthentication(message.requestId, outcome);
    }
  }

  private acceptAuthentication(
    requestId: string,
    outcome: Extract<PicaMobileAuthOutcome, { ok: true }>,
    capabilities: readonly PicaMobileCapability[],
  ): void {
    this.session = {
      userId: outcome.user.id,
      sessionToken: outcome.sessionToken,
    };
    this.lastValidated = this.now();
    this.consecutiveRejections = 0;

    if (this.authenticationTimer !== null) {
      clearTimeout(this.authenticationTimer);
      this.authenticationTimer = null;
    }

    this.send(
      encodePicaMobileConnected(requestId, {
        connectionId: this.options.connectionId,
        user: outcome.user,
        sessionToken: outcome.isSessionIssued ? outcome.sessionToken : null,
        heartbeat: {
          intervalMilliseconds: PICA_MOBILE_HEARTBEAT_INTERVAL_MILLISECONDS,
          timeoutMilliseconds: PICA_MOBILE_HEARTBEAT_TIMEOUT_MILLISECONDS,
        },
        server: {
          version: this.options.serverVersion,
          protocolVersions: PICA_MOBILE_SUPPORTED_VERSIONS,
          capabilities,
        },
      }),
    );
    this.conversations.start();
    this.calendar.start();
    logEvent({
      level: "info",
      event: "pica_mobile.connection.authenticated",
      component: COMPONENT,
      message: "Pica Mobile connection authenticated",
      metadata: { userId: outcome.user.id },
    });
  }

  private rejectAuthentication(
    requestId: string,
    outcome: Extract<PicaMobileAuthOutcome, { ok: false }>,
  ): void {
    this.failedAuthentications += 1;
    logEvent({
      level: "warn",
      event: "pica_mobile.authentication.rejected",
      component: COMPONENT,
      message: "Pica Mobile authentication rejected",
      metadata: { reason: outcome.reason },
    });
    this.reject(describePicaMobileAuthenticationFailure(requestId, outcome));

    if (this.failedAuthentications >= MAXIMUM_FAILED_AUTHENTICATIONS) {
      this.close(CLOSE_POLICY, "Too many failed authentications");
    }
  }

  private reject(rejection: PicaMobileRejection): void {
    this.consecutiveRejections += 1;
    this.send(encodePicaMobileError(rejection));

    if (this.loggedRejections < MAXIMUM_LOGGED_REJECTIONS) {
      this.loggedRejections += 1;
      logEvent({
        level: "warn",
        event: "pica_mobile.protocol.rejected",
        component: COMPONENT,
        message: "Pica Mobile message rejected",
        metadata: { code: rejection.code },
      });
    }

    if (this.consecutiveRejections >= MAXIMUM_CONSECUTIVE_REJECTIONS) {
      this.logClosing("rejections");
      this.close(CLOSE_POLICY, "Too many rejected messages");
    }
  }

  private reportFailure(requestId: string | null, error: unknown): void {
    logEvent({
      level: "error",
      event: "pica_mobile.message.failed",
      component: COMPONENT,
      message: "Pica Mobile message could not be handled",
      error,
    });
    this.reject({
      code: PICA_MOBILE_ERROR_CODE.SERVER_UNAVAILABLE,
      message: "Pages cannot handle the message right now.",
      requestId,
    });
  }

  private checkHeartbeat(): void {
    const current = this.now();

    if (current - this.lastSeen > PICA_MOBILE_HEARTBEAT_TIMEOUT_MILLISECONDS) {
      this.logClosing("heartbeat_timeout");
      this.channel.terminate();

      return;
    }

    this.channel.ping();

    if (
      this.session !== null &&
      current - this.lastValidated >= REVALIDATION_INTERVAL_MILLISECONDS
    ) {
      this.lastValidated = current;
      void this.revalidate(this.session);
    }
  }

  private async revalidate(session: PicaMobileSessionIdentity): Promise<void> {
    try {
      if (
        await this.options.authenticator.isSessionActive(session.sessionToken)
      ) {
        return;
      }
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      // A database hiccup is no reason to drop a healthy connection.
      return;
    }

    this.endSession(null);
  }

  private endSession(requestId: string | null): void {
    this.logClosing("session_ended");
    this.send(
      encodePicaMobileError({
        code: PICA_MOBILE_ERROR_CODE.AUTHENTICATION_FAILED,
        message: "The session has ended.",
        requestId,
      }),
    );
    this.close(CLOSE_POLICY, "Session ended");
  }

  /** Hands a frame to the socket; tells whether that worked. */
  private send(frame: string): boolean {
    try {
      this.channel.send(frame);

      return true;
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      this.channel.terminate();

      return false;
    }
  }

  private logClosing(reason: string): void {
    logEvent({
      level: "info",
      event: "pica_mobile.connection.closing",
      component: COMPONENT,
      message: "Pica Mobile connection is being closed by the server",
      metadata: { reason },
    });
  }
}
