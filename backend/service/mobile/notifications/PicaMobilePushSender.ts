/**
 * Notification channels of the Pica Mobile app: two for plan notifications,
 * one for new messages of conversations (PAGE-278).
 */
export type PicaMobilePushChannel =
  "pica-plan-steps" | "pica-plan-results" | "pica-conversation-messages";

/**
 * One push message for one registered device, in the words of Pages.
 *
 * @remarks
 * The sender turns it into the request of its provider. `data` holds text
 * values only and already contains the `tag`; the title and body are generic
 * unless the device registered for details and its rights were checked again.
 */
export interface PicaMobilePushMessage {
  /** The confidential native token of the device; it never reaches a log. */
  readonly token: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>>;
  readonly channelId: PicaMobilePushChannel;
  /** Replaces a notification with the same tag on the device. */
  readonly tag: string;
  /** Seconds the push service may still hold the message; at least 1. */
  readonly ttlSeconds: number;
}

/**
 * What a sender made of one message.
 *
 * @remarks
 * `sent` means the push service accepted the message, not that the device
 * displayed it. `invalidToken` says the token itself is unusable and the
 * registration may be removed. `rejected` says this message cannot be
 * delivered, whatever the token; the registration stays. `retry` is a
 * transient failure, optionally with the wait the service asked for.
 * `unavailable` means the sender itself cannot work right now, for example
 * because of its credentials or an exhausted quota of the project.
 */
export type PicaMobilePushOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "invalidToken" }
  | { readonly kind: "rejected" }
  | { readonly kind: "retry"; readonly retryAfterSeconds?: number }
  | { readonly kind: "unavailable" };

/** Delivers push messages to a push service. */
export interface PicaMobilePushSender {
  /**
   * Gets the sender ready to send, for example by fetching its credentials.
   *
   * @returns `false` when it cannot send right now. It never rejects.
   *
   * @remarks
   * The dispatcher calls it before it hands out any delivery, so a rights
   * check is not followed by a slow credential request.
   */
  ready(): Promise<boolean>;
  /**
   * Sends one message.
   *
   * @param message - What to deliver and to whom.
   * @returns The outcome; it never rejects, a failure is an outcome.
   */
  send(message: PicaMobilePushMessage): Promise<PicaMobilePushOutcome>;
}
