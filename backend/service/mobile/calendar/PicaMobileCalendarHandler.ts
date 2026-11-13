import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_ERROR_CODE } from "@/definition/PicaMobileProtocol";

import { PicaMobileCalendarFeed } from "./PicaMobileCalendarFeed";
import { encodePicaMobileCalendar } from "./PicaMobileCalendarMessages";

import type { PicaMobilePlansHost } from "../plans/PicaMobilePlansHandler";
import type { PicaMobileCalendarClientMessage } from "./PicaMobileCalendarMessages";
import type { PicaMobileCalendarProvider } from "./PicaMobileCalendarProvider";

const COMPONENT = "PicaMobileCalendarHandler";

/**
 * Answers `calendar.v1` for one connection (PAGE-301) and sends it the
 * `calendar_changed` messages of its account.
 *
 * @remarks
 * Every request is answered once: with its answer, with `error` and
 * `forbidden`, `not_found` or `invalid_request` for a refusal, or with
 * `server_unavailable` when Pages cannot answer. An ended session ends the
 * connection. The changes are heard from the authentication until the
 * connection stops.
 */
export class PicaMobileCalendarHandler {
  private readonly provider: PicaMobileCalendarProvider | undefined;
  private readonly host: PicaMobilePlansHost;
  private readonly feed: PicaMobileCalendarFeed | null;

  /**
   * Creates the handler.
   *
   * @param provider - The calendar; none: the requests are unknown.
   * @param host - The connection the handler answers on.
   */
  public constructor(
    provider: PicaMobileCalendarProvider | undefined,
    host: PicaMobilePlansHost,
  ) {
    this.provider = provider;
    this.host = host;
    this.feed =
      provider === undefined ? null : new PicaMobileCalendarFeed(provider, host);
  }

  /** Starts sending the changes of the account; called once after the authentication. */
  public start(): void {
    this.feed?.start();
  }

  /** Stops sending changes once the connection closes. */
  public stop(): void {
    this.feed?.stop();
  }

  /**
   * Handles one request of `calendar.v1`.
   *
   * @param message - A request that passed every check of its payload.
   */
  public async handle(message: PicaMobileCalendarClientMessage): Promise<void> {
    const { host, provider } = this;
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
      const { requestId } = message;
      const outcome = await provider.answer(session, message);
      if (!host.isOpen()) return;
      if (outcome.kind === "sessionEnded") {
        host.endSession(requestId);
      } else if (outcome.kind === "refused") {
        host.reject({ code: outcome.code, message: outcome.message, requestId });
      } else {
        host.acknowledge();
        host.send(encodePicaMobileCalendar(requestId, outcome.answer));
      }
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      host.reportFailure(message.requestId, error);
    }
  }
}
