import { z } from "zod";

/** The only platform `notifications.v1` registers. */
export const PICA_MOBILE_NOTIFICATION_PLATFORM = "android";

/** The only push provider `notifications.v1` registers. */
export const PICA_MOBILE_NOTIFICATION_PROVIDER = "fcm";

/** Registrations one account keeps; the oldest one that was not renewed makes room. */
export const PICA_MOBILE_MAXIMUM_REGISTRATIONS_PER_ACCOUNT = 10;

/** Longest native FCM token Pages accepts in `notification_register`. */
export const PICA_MOBILE_MAXIMUM_PUSH_TOKEN_LENGTH = 4096;

/** Longest identifier of an account, plan or run in a notification. */
export const PICA_MOBILE_MAXIMUM_IDENTIFIER_LENGTH = 200;

/** Longest plan or step name in a `notification_event` answer. */
export const PICA_MOBILE_MAXIMUM_NAME_LENGTH = 500;

/** Longest reason of a failed run in a `notification_event` answer. */
export const PICA_MOBILE_MAXIMUM_REASON_LENGTH = 200;

/** Most steps one `step_started` event names; `stepCount` counts the rest. */
export const PICA_MOBILE_MAXIMUM_EVENT_STEPS = 20;

/** Largest `stepCount` of a `step_started` event. */
export const PICA_MOBILE_MAXIMUM_STEP_COUNT = 1000;

/**
 * Longest frame of a notification answer, in UTF-16 code units.
 *
 * @remarks
 * The app counts the text of a frame this way and ends the connection on a
 * longer one, so a `notification_event` answer is shortened to fit.
 */
export const PICA_MOBILE_MAXIMUM_NOTIFICATION_FRAME_LENGTH = 16_384;

/** Room the envelope of an answer takes: version, type and a 64 character request identifier. */
export const PICA_MOBILE_NOTIFICATION_ENVELOPE_RESERVE = 256;

/** Shortest and longest time a missed notification may still be replayed, in seconds. */
export const PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS = {
  minimum: 60,
  maximum: 3600,
} as const;

/** Time a notification stays deliverable unless an operator sets another one. */
export const PICA_MOBILE_DEFAULT_REPLAY_TTL_SECONDS = 900;

/** Types of the events a run produces. */
export const PICA_MOBILE_NOTIFICATION_EVENT_TYPE = {
  STEP_STARTED: "step_started",
  RUN_CANCELLED: "run_cancelled",
  RUN_FAILED: "run_failed",
  RUN_SUCCEEDED: "run_succeeded",
} as const;

/** One type of {@link PICA_MOBILE_NOTIFICATION_EVENT_TYPE}. */
export type PicaMobileNotificationEventType =
  (typeof PICA_MOBILE_NOTIFICATION_EVENT_TYPE)[keyof typeof PICA_MOBILE_NOTIFICATION_EVENT_TYPE];

/** Device and event identifiers are unpredictable, printable and safe to echo. */
export const picaMobileNotificationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/u);

/** A native FCM token: printable, without white space, bounded. */
export const picaMobilePushTokenSchema = z
  .string()
  .min(1)
  .max(PICA_MOBILE_MAXIMUM_PUSH_TOKEN_LENGTH)
  .regex(/^\S+$/u)
  .refine((token) => !token.includes("\u0000"));

/** How much of a run a push notification reveals before the device is unlocked. */
export const picaMobileNotificationPreviewSchema = z.enum([
  "hidden",
  "details",
]);

/** Language of the generic texts a push notification carries. */
export type PicaMobileNotificationLocale = "de" | "en";

/** How much of a run a registered device may see in a push notification. */
export type PicaMobileNotificationPreview = z.infer<
  typeof picaMobileNotificationPreviewSchema
>;

/** A `notification_unregister` message names the device whose registration ends. */
export const picaMobileNotificationUnregisterPayloadSchema = z.object({
  deviceId: picaMobileNotificationIdSchema,
});

/** A `notification_event_get` message names the event a push notification announced. */
export const picaMobileNotificationEventGetPayloadSchema = z.object({
  eventId: picaMobileNotificationIdSchema,
});

/** The answer to a successful `notification_register`. */
export interface PicaMobileNotificationRegisteredPayload {
  readonly deviceId: string;
  /** Identifies this Pages instance; stable across restarts and moves of the instance. */
  readonly instanceId: string;
  /** Always the identifier of the account the connection authenticated. */
  readonly accountId: string;
  /** ISO-8601 moment the binding began; a renewal keeps it. */
  readonly registeredAt: string;
  /** Seconds after an event during which it is still delivered. */
  readonly replayTtlSeconds: number;
}

/** The answer to `notification_unregister`; the same for a known and an unknown device. */
export interface PicaMobileNotificationUnregisteredPayload {
  readonly deviceId: string;
}

/** State of a run in the words of the Pages runner. */
export type PicaMobileNotificationRunStatus =
  | "running"
  | "pausing"
  | "paused"
  | "stopping"
  | "succeeded"
  | "failed"
  | "cancelled";

/** One step instance a `step_started` event names. */
export interface PicaMobileNotificationStep {
  readonly instanceId: string;
  /** Number of the node in the flow, `null` when Pages cannot name it. */
  readonly number: number | null;
  readonly name: string | null;
  readonly attempt: number;
  /** Loop iteration, `null` outside a loop. */
  readonly iteration: number | null;
}

/** The facts of one event, read again with the rights of the account. */
export interface PicaMobileNotificationEvent {
  readonly type: PicaMobileNotificationEventType;
  readonly occurredAt: string;
  /** Strictly rising per run; never reused. */
  readonly seq: number;
  readonly plan: { readonly id: string; readonly name: string };
  readonly run: {
    readonly id: string;
    readonly status: PicaMobileNotificationRunStatus;
  };
  /** Only for `step_started`. */
  readonly steps?: readonly PicaMobileNotificationStep[];
  /** Only for `step_started`: all steps the transition started. */
  readonly stepCount?: number;
  /** Only for `run_failed`: a cleaned reason or `null`. */
  readonly reason?: string | null;
}

/**
 * The answer to `notification_event_get`.
 *
 * @remarks
 * `forbidden` and `gone` carry nothing but the identifier: no names, no link.
 * `detailUrl` belongs beside `event` in the payload, where the app reads it,
 * not inside `event`.
 */
export type PicaMobileNotificationEventPayload =
  | {
      readonly eventId: string;
      readonly access: "ok";
      readonly event: PicaMobileNotificationEvent;
      /** The page of the run, when Pages can name a safe one. */
      readonly detailUrl?: string;
    }
  | { readonly eventId: string; readonly access: "forbidden" | "gone" };
