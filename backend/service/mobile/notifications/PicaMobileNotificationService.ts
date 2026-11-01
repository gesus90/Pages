import type { PicaMobileNotificationEventPayload } from "@/definition/PicaMobileNotifications";
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
  /** Whether a usable push sender is configured. */
  readonly isPushAvailable: boolean;
  /** Stops listening to run transitions. */
  readonly detach: () => void;
}

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
}
