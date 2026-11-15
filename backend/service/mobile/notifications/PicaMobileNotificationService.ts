import type {
  NotificationPreferenceRecord,
  PicaMobileNotificationPreferenceRepository,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import type {
  NotificationChoices,
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
    "find" | "setTeamRuns" | "setChoices"
  >;
  /** Whether a usable push sender is configured. */
  readonly isPushAvailable: boolean;
  /** Stops listening to run transitions. */
  readonly detach: () => void;
  readonly now?: () => Date;
}

/** What an account asks to change; an absent choice stays as it is. */
export type PicaMobileSettingsChange = Partial<NotificationChoices>;

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
 * The notification backend of Pica Mobile and account notification choices.
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

  /** Reads the stored account choices for the Pages settings card and browser. */
  public async readChoices(accountId: string): Promise<NotificationChoices> {
    return this.parts.preferences.find(accountId);
  }

  /** Saves a Pages choice without changing device registration. */
  public async changeChoices(
    accountId: string,
    change: Partial<NotificationChoices>,
  ): Promise<NotificationPreferenceRecord> {
    const now = (this.parts.now?.() ?? new Date()).toISOString();
    if (change.teamRuns !== undefined) {
      await this.parts.preferences.setTeamRuns(accountId, change.teamRuns, now);
    }
    return this.parts.preferences.setChoices(accountId, change, now);
  }

  /**
   * Changes the choices of an account.
   *
   * @param accountId - The authenticated account; never taken from a message.
   * @param change - The choices to change.
   * @returns The choices as Pages delivers them now, or why nothing changed.
   *
   * @remarks
   * Switching team runs on is refused while Pages has no push sender. The
   * other choices remain stored for the browser and future device delivery.
   */
  public async changeSettings(
    accountId: string,
    change: PicaMobileSettingsChange,
  ): Promise<PicaMobileSettingsResult> {
    const { isPushAvailable } = this.parts;

    if (Object.keys(change).length === 0) {
      return { kind: "ready", payload: await this.readSettings(accountId) };
    }

    if (change.teamRuns === true && !isPushAvailable) {
      return { kind: "pushUnavailable" };
    }

    const stored = await this.changeChoices(accountId, change);

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
      receiveNotifications: preference.receiveNotifications,
      chats: preference.chats,
      pica: preference.pica,
      planInterruptions: preference.planInterruptions,
      planCompletions: preference.planCompletions,
      planAllStatuses: preference.planAllStatuses,
    };
  }
}
