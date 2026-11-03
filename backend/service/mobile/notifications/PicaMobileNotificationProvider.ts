import type {
  PicaMobileNotificationEventPayload,
  PicaMobileNotificationLocale,
  PicaMobileNotificationPreview,
  PicaMobileNotificationRegisteredPayload,
} from "@/definition/PicaMobileNotifications";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";

/** What a device asks to register, already validated. */
export interface PicaMobileRegistrationInput {
  readonly deviceId: string;
  readonly token: string;
  readonly locale: PicaMobileNotificationLocale;
  readonly preview: PicaMobileNotificationPreview;
}

/**
 * The answer to a registration.
 *
 * @remarks
 * `pushUnavailable` means Pages has no usable FCM sender; nothing was stored.
 * `sessionEnded` means the session or the account no longer holds.
 */
export type PicaMobileRegisterOutcome =
  | {
      readonly kind: "registered";
      readonly payload: PicaMobileNotificationRegisteredPayload;
      /** Starts delivery; the connection calls it after the answer was handed over. */
      readonly activate: () => Promise<void>;
    }
  | { readonly kind: "pushUnavailable" }
  | { readonly kind: "sessionEnded" };

/** The answer to an unregistration. */
export type PicaMobileUnregisterOutcome =
  { readonly kind: "done" } | { readonly kind: "sessionEnded" };

/** The answer to an event read. */
export type PicaMobileEventOutcome =
  | {
      readonly kind: "ready";
      readonly payload: PicaMobileNotificationEventPayload;
    }
  | { readonly kind: "sessionEnded" };

/**
 * The business answers of an authenticated Pica Mobile connection for
 * `notifications.v1`.
 *
 * @remarks
 * A connection without a provider announces neither `notifications.v1` nor
 * `notifications.push.fcm` and answers the three messages as unknown. Every
 * call decides from the account behind the session as it is now.
 */
export interface PicaMobileNotificationProvider {
  /** Tells whether a usable FCM sender exists; rejects only when Pages cannot decide. */
  isPushAvailable(): Promise<boolean>;
  /** Registers or renews the push token of a device for the session's account. */
  register(
    session: PicaMobileSessionIdentity,
    input: PicaMobileRegistrationInput,
  ): Promise<PicaMobileRegisterOutcome>;
  /** Removes a device of the session's account; unknown devices change nothing. */
  unregister(
    session: PicaMobileSessionIdentity,
    deviceId: string,
  ): Promise<PicaMobileUnregisterOutcome>;
  /** Reads the facts of an event with the rights the account has now. */
  readEvent(
    session: PicaMobileSessionIdentity,
    eventId: string,
  ): Promise<PicaMobileEventOutcome>;
}
