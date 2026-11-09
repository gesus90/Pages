import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_ERROR_CODE } from "@/definition/PicaMobileProtocol";

import {
  encodePicaMobileAvatar,
  encodePicaMobileDashboard,
} from "./PicaMobileMessages";

import type {
  PicaMobileDashboardProvider,
  PicaMobileSessionIdentity,
} from "./PicaMobileDashboardProvider";
import type { PicaMobileClientMessage } from "./PicaMobileMessages";
import type { PicaMobilePlansHost } from "./plans/PicaMobilePlansHandler";

/** A request of `dashboard.v1`. */
export type PicaMobileDashboardMessage = Extract<
  PicaMobileClientMessage,
  { readonly type: "dashboard_get" | "avatar_get" }
>;

const COMPONENT = "PicaMobileConnection";

/**
 * Answers `dashboard_get` and `avatar_get` for one connection.
 *
 * @remarks
 * Without a provider both requests are unknown. They need an authenticated
 * connection; the provider decides from the current rights of the account.
 */
export class PicaMobileDashboardHandler {
  private readonly provider: PicaMobileDashboardProvider | undefined;
  private readonly host: PicaMobilePlansHost;

  /**
   * Creates the handler.
   *
   * @param provider - The business answers; none: the requests are unknown.
   * @param host - The connection the handler answers on.
   */
  public constructor(
    provider: PicaMobileDashboardProvider | undefined,
    host: PicaMobilePlansHost,
  ) {
    this.provider = provider;
    this.host = host;
  }

  /**
   * Handles one request of `dashboard.v1`.
   *
   * @param message - A request that passed every check of its payload.
   */
  public async handle(message: PicaMobileDashboardMessage): Promise<void> {
    const { provider, host } = this;

    // A read queued behind a message that ended the connection would only be thrown away.
    if (!host.isOpen()) return;

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
      await (message.type === "dashboard_get"
        ? this.answerDashboard(message.requestId, provider, session)
        : this.answerAvatar(message, provider, session));
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      host.reportFailure(message.requestId, error);
    }
  }

  private async answerDashboard(
    requestId: string,
    provider: PicaMobileDashboardProvider,
    session: PicaMobileSessionIdentity,
  ): Promise<void> {
    const outcome = await provider.readDashboard(session);

    if (!this.host.isOpen()) return;

    if (outcome.kind === "sessionEnded") {
      this.host.endSession(requestId);
      return;
    }

    this.host.acknowledge();
    this.host.send(encodePicaMobileDashboard(requestId, outcome.dashboard));
  }

  private async answerAvatar(
    message: Extract<
      PicaMobileDashboardMessage,
      { readonly type: "avatar_get" }
    >,
    provider: PicaMobileDashboardProvider,
    session: PicaMobileSessionIdentity,
  ): Promise<void> {
    const outcome = await provider.readAvatar(session, message.payload.version);

    if (!this.host.isOpen()) return;

    if (outcome.kind === "sessionEnded") {
      this.host.endSession(message.requestId);
    } else if (outcome.kind === "notFound") {
      this.host.reject({
        code: PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
        message: "The requested avatar version is not available.",
        requestId: message.requestId,
      });
    } else {
      this.host.acknowledge();
      this.host.send(encodePicaMobileAvatar(message.requestId, outcome.avatar));
    }
  }
}
