import { readCurrentSessionUser } from "../PicaMobileSessionUser";

import type { AuthService } from "@/backend/auth/AuthService";
import type { SessionService } from "@/backend/auth/SessionService";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type {
  PicaMobileEventOutcome,
  PicaMobileNotificationProvider,
  PicaMobileRegisterOutcome,
  PicaMobileRegistrationInput,
  PicaMobileUnregisterOutcome,
} from "./PicaMobileNotificationProvider";
import type { PicaMobileNotificationService } from "./PicaMobileNotificationService";

/** The Pages services the notification messages read from. */
export interface PicaMobileNotificationServices {
  readonly authService: Pick<AuthService, "getAuthenticatedUser">;
  readonly sessionService: Pick<SessionService, "findSessionId">;
  readonly picaMobileNotifications: Pick<
    PicaMobileNotificationService,
    "isPushAvailable" | "register" | "unregister" | "readEvent"
  >;
}

/**
 * Answers the notification messages of Pica Mobile from the live Pages data.
 *
 * @remarks
 * Every call starts from the account the session belongs to right now. The
 * recipient of a registration is that account and the binding is that
 * session; neither comes from the message.
 */
export class PagesPicaMobileNotifications
  implements PicaMobileNotificationProvider
{
  private readonly resolveServices: () => Promise<PicaMobileNotificationServices>;

  /**
   * Creates the provider.
   *
   * @param resolveServices - Resolves the Pages services when a request needs
   * them, so the listener works before the database does.
   */
  public constructor(
    resolveServices: () => Promise<PicaMobileNotificationServices>,
  ) {
    this.resolveServices = resolveServices;
  }

  /** Tells whether Pages has a usable FCM sender. */
  public async isPushAvailable(): Promise<boolean> {
    return (await this.resolveServices()).picaMobileNotifications.isPushAvailable();
  }

  /** Registers a device for the account of the session. */
  public async register(
    session: PicaMobileSessionIdentity,
    input: PicaMobileRegistrationInput,
  ): Promise<PicaMobileRegisterOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    const notifications = services.picaMobileNotifications;

    if (!notifications.isPushAvailable()) {
      return { kind: "pushUnavailable" };
    }

    const sessionId = await services.sessionService.findSessionId(
      session.sessionToken,
    );

    if (sessionId === null) {
      return { kind: "sessionEnded" };
    }

    const registration = await notifications.register({
      accountId: user.id,
      sessionId,
      ...input,
    });

    return {
      kind: "registered",
      payload: registration.payload,
      activate: registration.activate,
    };
  }

  /** Removes a device of the account of the session. */
  public async unregister(
    session: PicaMobileSessionIdentity,
    deviceId: string,
  ): Promise<PicaMobileUnregisterOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    await services.picaMobileNotifications.unregister(user.id, deviceId);

    return { kind: "done" };
  }

  /** Reads an event with the rights the account has now. */
  public async readEvent(
    session: PicaMobileSessionIdentity,
    eventId: string,
  ): Promise<PicaMobileEventOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    return {
      kind: "ready",
      payload: await services.picaMobileNotifications.readEvent(
        user.id,
        eventId,
      ),
    };
  }
}
