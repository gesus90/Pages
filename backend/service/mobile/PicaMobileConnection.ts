import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  PICA_MOBILE_AUTHENTICATION_TIMEOUT_MILLISECONDS,
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_HEARTBEAT_INTERVAL_MILLISECONDS,
  PICA_MOBILE_HEARTBEAT_TIMEOUT_MILLISECONDS,
  PICA_MOBILE_SUPPORTED_VERSIONS,
} from "@/definition/PicaMobileProtocol";

import {
  encodePicaMobileConnected,
  encodePicaMobileError,
  encodePicaMobilePong,
  parsePicaMobileMessage,
} from "./PicaMobileMessages";

import type {
  PicaMobileAuthenticator,
  PicaMobileAuthOutcome,
  PicaMobileClientOrigin,
} from "./PicaMobileAuthenticator";
import type { PicaMobileClientMessage } from "./PicaMobileMessages";
import type { PicaMobileRejection } from "./PicaMobileMessages";

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
  /** Clock in milliseconds; tests replace it. */
  readonly now?: () => number;
}

const CLOSE_GOING_AWAY = 1001;
const CLOSE_POLICY = 1008;
const CLOSE_GRACE_MILLISECONDS = 2_000;
const REVALIDATION_INTERVAL_MILLISECONDS = 60_000;
const RATE_WINDOW_MILLISECONDS = 10_000;
const MAXIMUM_MESSAGES_PER_WINDOW = 30;
const MAXIMUM_PENDING_MESSAGES = 8;
const MAXIMUM_CONSECUTIVE_REJECTIONS = 5;
const MAXIMUM_FAILED_AUTHENTICATIONS = 3;
const MAXIMUM_LOGGED_REJECTIONS = 5;
const COMPONENT = "PicaMobileConnection";

interface AuthenticatedSession {
  readonly userId: string;
  readonly sessionToken: string;
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
  private readonly now: () => number;
  private session: AuthenticatedSession | null = null;
  private isStopped = false;
  private isClosing = false;
  private lastSeen: number;
  private lastValidated: number;
  private windowStart: number;
  private windowMessages = 0;
  private pendingMessages = 0;
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
    this.windowStart = this.lastSeen;
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

  /** Handles a text frame of the peer. */
  public receiveText(text: string): void {
    if (!this.admit()) {
      return;
    }

    this.pendingMessages += 1;
    void this.queue.run(async () => {
      try {
        await this.handleText(text);
      } catch (error: unknown) {
        logCaughtError(COMPONENT, error);

        this.reportFailure(null, error);
      } finally {
        this.pendingMessages -= 1;
      }
    });
  }

  /** Handles a binary frame, which the protocol does not use. */
  public receiveBinary(): void {
    if (!this.admit()) {
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
  private admit(): boolean {
    this.lastSeen = this.now();

    if (this.isStopped || this.isClosing) {
      return false;
    }

    if (this.isOverRate()) {
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

    if (this.pendingMessages >= MAXIMUM_PENDING_MESSAGES) {
      this.logClosing("queue_limit");
      this.close(CLOSE_POLICY, "Too many pending messages");

      return false;
    }

    return true;
  }

  private isOverRate(): boolean {
    const current = this.now();

    if (current - this.windowStart >= RATE_WINDOW_MILLISECONDS) {
      this.windowStart = current;
      this.windowMessages = 0;
    }

    this.windowMessages += 1;

    return this.windowMessages > MAXIMUM_MESSAGES_PER_WINDOW;
  }

  private async handleText(text: string): Promise<void> {
    const parsed = parsePicaMobileMessage(text);

    if (!parsed.ok) {
      this.reject(parsed.rejection);

      return;
    }

    await this.dispatch(parsed.message);
  }

  private async dispatch(message: PicaMobileClientMessage): Promise<void> {
    if (message.type === "auth") {
      await this.authenticate(message);

      return;
    }

    if (this.session === null) {
      this.reject({
        code: PICA_MOBILE_ERROR_CODE.AUTHENTICATION_REQUIRED,
        message: "Authenticate with an auth message first.",
        requestId: message.requestId,
      });

      return;
    }

    this.consecutiveRejections = 0;
    this.send(encodePicaMobilePong(message.requestId, new Date(this.now())));
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
      this.acceptAuthentication(message.requestId, outcome);
    } else {
      this.rejectAuthentication(message.requestId, outcome);
    }
  }

  private acceptAuthentication(
    requestId: string,
    outcome: Extract<PicaMobileAuthOutcome, { ok: true }>,
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
        },
      }),
    );
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
    this.reject(describeAuthenticationFailure(requestId, outcome));

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

  private async revalidate(session: AuthenticatedSession): Promise<void> {
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

    this.logClosing("session_ended");
    this.send(
      encodePicaMobileError({
        code: PICA_MOBILE_ERROR_CODE.AUTHENTICATION_FAILED,
        message: "The session has ended.",
        requestId: null,
      }),
    );
    this.close(CLOSE_POLICY, "Session ended");
  }

  private send(frame: string): void {
    try {
      this.channel.send(frame);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      this.channel.terminate();
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

function describeAuthenticationFailure(
  requestId: string,
  outcome: Extract<PicaMobileAuthOutcome, { ok: false }>,
): PicaMobileRejection {
  if (outcome.reason === "tooManyAttempts") {
    return {
      code: PICA_MOBILE_ERROR_CODE.TOO_MANY_ATTEMPTS,
      message: "Too many failed sign-in attempts. Try again later.",
      requestId,
      ...(outcome.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: outcome.retryAfterSeconds }),
    };
  }

  if (outcome.reason === "passwordChangeRequired") {
    return {
      code: PICA_MOBILE_ERROR_CODE.PASSWORD_CHANGE_REQUIRED,
      message: "Change the password in Pages before connecting.",
      requestId,
    };
  }

  return {
    code: PICA_MOBILE_ERROR_CODE.AUTHENTICATION_FAILED,
    message: "The credentials are not valid.",
    requestId,
  };
}
