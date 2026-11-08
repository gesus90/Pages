import type {
  NotificationPreferenceRecord,
  PicaMobileNotificationPreferenceRepository,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import type {
  PicaMobileNotificationEventPayload,
  PicaMobileNotificationSettingsPayload,
} from "@/definition/PicaMobileNotifications";
import type { PicaMobileNotificationDispatcher } from "./PicaMobileNotificationDispatcher";
import type { PicaMobileNotificationEventReader } from "./PicaMobileNotificationEventReader";
import type { PicaMobileNotificationRecorder } from "./PicaMobileNotificationRecorder";
import type {
  PicaMobilePushRegistrations,
  PicaMobileRegistrationRequest,
  PicaMobileRegistrationResult,
} from "./PicaMobilePushRegistrations";

/** The parts of the notification service. */
export interface PicaMobileNotificationParts {
  readonly registrations: PicaMobilePushRegistrations;
  readonly events: PicaMobileNotificationEventReader;
  readonly recorder: PicaMobileNotificationRecorder;
  readonly dispatcher: PicaMobileNotificationDispatcher;
  readonly preferences: Pick<
    PicaMobileNotificationPreferenceRepository,
    "find" | "setTeamRuns"
  >;
  /** Whether a usable push sender is configured. */
  readonly isPushAvailable: boolean;
  /** Stops listening to run transitions. */
  readonly detach: () => void;
  readonly now?: () => Date;
}

/** What an account asks to change; an absent choice stays as it is. */
export interface PicaMobileSettingsChange {
  readonly teamRuns?: boolean;
}

/**
 * The outcome of a change of the choices.
 *
 * @remarks
 * `pushUnavailable`: the account asked to switch something on that this Pages
 * cannot deliver without a push sender; nothing was stored.
 */
export type PicaMobileSettingsResult =
  | {
      readonly kind: "ready";
      readonly payload: PicaMobileNotificationSettingsPayload;
    }
  | { readonly kind: "pushUnavailable" };

/**
 * The notification backend of Pica Mobile for plan runs.
 *
 * @remarks
 * It registers devices, records the events of runs, sends the pushes and
 * answers event reads. The parts that touch the execution of plans only
 * observe: whatever happens to the push service, a run is never changed,
 * delayed or blocked by it.
 */
export class PicaMobileNotificationService {
  private readonly parts: PicaMobileNotificationParts;

  /**
   * Creates the service from its parts.
   *
   * @param parts - Registrations, event reader, recorder, dispatcher and the sender state.
   */
  public constructor(parts: PicaMobileNotificationParts) {
    this.parts = parts;
  }

  /** Tells whether Pages has a usable FCM sender and therefore accepts registrations. */
  public isPushAvailable(): boolean {
    return this.parts.isPushAvailable;
  }

  /** Registers a device, or renews its registration. */
  public register(
    request: PicaMobileRegistrationRequest,
  ): Promise<PicaMobileRegistrationResult> {
    return this.parts.registrations.register(request);
  }

  /** Removes a device of an account; an unknown device changes nothing. */
  public unregister(accountId: string, deviceId: string): Promise<void> {
    return this.parts.registrations.unregister(accountId, deviceId);
  }

  /** Reads an event with the rights the account has now. */
  public readEvent(
    accountId: string,
    eventId: string,
  ): Promise<PicaMobileNotificationEventPayload> {
    return this.parts.events.read(accountId, eventId);
  }

  /**
   * Reads the choices of an account as Pages delivers them now.
   *
   * @param accountId - The authenticated account; never taken from a message.
   */
  public async readSettings(
    accountId: string,
  ): Promise<PicaMobileNotificationSettingsPayload> {
    return this.toSettings(await this.parts.preferences.find(accountId));
  }

  /**
   * Changes the choices of an account.
   *
   * @param accountId - The authenticated account; never taken from a message.
   * @param change - The choices to change.
   * @returns The choices as Pages delivers them now, or why nothing changed.
   *
   * @remarks
   * Switching a choice off is always possible. Switching it on is refused
   * while this Pages has no push sender, so it is never reported as on
   * without being delivered.
   */
  public async changeSettings(
    accountId: string,
    change: PicaMobileSettingsChange,
  ): Promise<PicaMobileSettingsResult> {
    const { preferences, isPushAvailable } = this.parts;

    if (change.teamRuns === undefined) {
      return { kind: "ready", payload: await this.readSettings(accountId) };
    }

    if (change.teamRuns && !isPushAvailable) {
      return { kind: "pushUnavailable" };
    }

    const stored = await preferences.setTeamRuns(
      accountId,
      change.teamRuns,
      (this.parts.now?.() ?? new Date()).toISOString(),
    );

    return { kind: "ready", payload: this.toSettings(stored) };
  }

  /** Starts sending what is pending, including pushes left from before a restart. */
  public start(): void {
    this.parts.dispatcher.start();
  }

  /** Stops observing runs, finishes what was recorded and stops sending. */
  public async stop(): Promise<void> {
    this.parts.detach();
    await this.parts.recorder.stop();
    await this.parts.dispatcher.stop();
  }

  private toSettings(
    preference: NotificationPreferenceRecord,
  ): PicaMobileNotificationSettingsPayload {
    const isAvailable = this.parts.isPushAvailable;

    return {
      accountId: preference.accountId,
      teamRuns: {
        isAvailable,
        isEnabled: isAvailable && preference.teamRuns,
      },
    };
  }
}
