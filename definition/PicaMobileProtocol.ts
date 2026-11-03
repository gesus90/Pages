import { z } from "zod";

import type {
  PicaMobileNotificationEventPayload,
  PicaMobileNotificationRegisteredPayload,
  PicaMobileNotificationUnregisteredPayload,
} from "./PicaMobileNotifications";

/** Version of the JSON message format spoken on the Pica Mobile WebSocket. */
export const PICA_MOBILE_PROTOCOL_VERSION = 1;

/** Versions the server accepts in the `version` field of a message. */
export const PICA_MOBILE_SUPPORTED_VERSIONS: readonly number[] = [
  PICA_MOBILE_PROTOCOL_VERSION,
];

/** Largest text frame the server accepts; a larger one closes the connection. */
export const PICA_MOBILE_MAXIMUM_MESSAGE_BYTES = 16_384;

/** How often the server probes a connection with a WebSocket ping. */
export const PICA_MOBILE_HEARTBEAT_INTERVAL_MILLISECONDS = 20_000;

/** Silence after which the server drops a connection as orphaned. */
export const PICA_MOBILE_HEARTBEAT_TIMEOUT_MILLISECONDS = 45_000;

/** Time a new connection has to authenticate before the server closes it. */
export const PICA_MOBILE_AUTHENTICATION_TIMEOUT_MILLISECONDS = 10_000;

/** Largest decoded avatar image the server delivers in an `avatar` message. */
export const PICA_MOBILE_MAXIMUM_AVATAR_BYTES = 131_072;

/** Most plan rows one connection holds; `plans` never lists more. */
export const PICA_MOBILE_MAXIMUM_PLAN_ROWS = 200;

/** Longest `plans` or `plan` frame the server sends, in UTF-16 code units. */
export const PICA_MOBILE_MAXIMUM_PLANS_FRAME_LENGTH = 262_144;

/** Longest text of a plan row field such as a name or a step, in UTF-16 code units. */
export const PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH = 200;

/** Types of the messages a client sends. */
export const PICA_MOBILE_CLIENT_MESSAGE_TYPE = {
  AUTH: "auth",
  PING: "ping",
  DASHBOARD_GET: "dashboard_get",
  AVATAR_GET: "avatar_get",
  NOTIFICATION_REGISTER: "notification_register",
  NOTIFICATION_UNREGISTER: "notification_unregister",
  NOTIFICATION_EVENT_GET: "notification_event_get",
  PLANS_SYNC: "plans_sync",
  PLAN_GET: "plan_get",
} as const;

/** Types of the messages the server sends. */
export const PICA_MOBILE_SERVER_MESSAGE_TYPE = {
  CONNECTED: "connected",
  PONG: "pong",
  ERROR: "error",
  DASHBOARD: "dashboard",
  AVATAR: "avatar",
  NOTIFICATION_REGISTERED: "notification_registered",
  NOTIFICATION_UNREGISTERED: "notification_unregistered",
  NOTIFICATION_EVENT: "notification_event",
  PLANS: "plans",
  PLAN: "plan",
} as const;

/**
 * Extensions of version 1 that a server announces in `connected`.
 *
 * @remarks
 * `dashboard.v1` stands for the whole dashboard contract: `dashboard_get`,
 * `dashboard`, `avatar_get` and `avatar`. A server names it only for a
 * connection that answers all of them. `notifications.v1` stands for
 * `notification_register`, `notification_unregister` and
 * `notification_event_get` with their answers. `notifications.push.fcm` is
 * named only while the server has a usable FCM sender; without it a
 * registration is refused. There is no `notifications.push.apns`.
 * `plans.v1` stands for `plans_sync` and `plan_get` with their answers and
 * for the `plans` messages the server sends on its own.
 */
export const PICA_MOBILE_CAPABILITY = {
  DASHBOARD_V1: "dashboard.v1",
  PLANS_V1: "plans.v1",
  NOTIFICATIONS_V1: "notifications.v1",
  NOTIFICATIONS_PUSH_FCM: "notifications.push.fcm",
} as const;

/** One extension of {@link PICA_MOBILE_CAPABILITY}. */
export type PicaMobileCapability =
  (typeof PICA_MOBILE_CAPABILITY)[keyof typeof PICA_MOBILE_CAPABILITY];

/** Machine-readable reasons the server rejects a message or a connection. */
export const PICA_MOBILE_ERROR_CODE = {
  INVALID_MESSAGE: "invalid_message",
  UNSUPPORTED_VERSION: "unsupported_version",
  UNKNOWN_TYPE: "unknown_type",
  AUTHENTICATION_REQUIRED: "authentication_required",
  AUTHENTICATION_FAILED: "authentication_failed",
  PASSWORD_CHANGE_REQUIRED: "password_change_required",
  TOO_MANY_ATTEMPTS: "too_many_attempts",
  ALREADY_AUTHENTICATED: "already_authenticated",
  RATE_LIMITED: "rate_limited",
  SERVER_UNAVAILABLE: "server_unavailable",
} as const;

/** One reason of {@link PICA_MOBILE_ERROR_CODE}. */
export type PicaMobileErrorCode =
  (typeof PICA_MOBILE_ERROR_CODE)[keyof typeof PICA_MOBILE_ERROR_CODE];

/** Request identifiers are short, printable and safe to echo and to log. */
export const picaMobileRequestIdSchema = z.string().regex(/^[\w.:-]{1,64}$/u);

/**
 * The credentials of an `auth` message.
 *
 * @remarks
 * `session` resumes with a session token the server issued before; `password`
 * signs in with the Pages account and receives such a token in the answer.
 */
export const picaMobileAuthPayloadSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("session"),
    token: z.string().min(1).max(256),
  }),
  z.object({
    method: z.literal("password"),
    username: z.string().min(1).max(200),
    password: z.string().min(1).max(1000),
  }),
]);

/** Credentials a client presents to authenticate. */
export type PicaMobileAuthPayload = z.infer<typeof picaMobileAuthPayloadSchema>;

/** A `ping` message carries nothing. */
export const picaMobilePingPayloadSchema = z.object({});

/** A `dashboard_get` message carries nothing; the answer belongs to the signed-in account. */
export const picaMobileDashboardGetPayloadSchema = z.object({});

/** Avatar versions are short, printable and safe to echo; the server chooses them. */
export const picaMobileAvatarVersionSchema = z
  .string()
  .regex(/^[\w.:-]{1,64}$/u);

/** An `avatar_get` message names the avatar version the dashboard announced. */
export const picaMobileAvatarGetPayloadSchema = z.object({
  version: picaMobileAvatarVersionSchema,
});

/**
 * A `plans_sync` message names the `seq` of the last `plans` message the
 * client applied; `null` asks for the full list.
 */
export const picaMobilePlansSyncPayloadSchema = z.object({
  since: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
});

/** A `plan_get` message names the plan whose latest own run the client wants. */
export const picaMobilePlanGetPayloadSchema = z.object({
  planId: z.string().min(1).max(PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH),
});

/** A message of the Pica Mobile protocol, sent in either direction as JSON text. */
export interface PicaMobileEnvelope<Type extends string, Payload> {
  readonly version: typeof PICA_MOBILE_PROTOCOL_VERSION;
  readonly type: Type;
  /** Identifier a client chose; the answer repeats it, `null` when none is known. */
  readonly requestId: string | null;
  readonly payload: Payload;
}

/** The account a connection belongs to. */
export interface PicaMobileUserPayload {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

/** The answer to a successful `auth` message. */
export interface PicaMobileConnectedPayload {
  readonly connectionId: string;
  readonly user: PicaMobileUserPayload;
  /** The session token issued for a `password` sign-in; `null` for `session`. */
  readonly sessionToken: string | null;
  readonly heartbeat: {
    readonly intervalMilliseconds: number;
    readonly timeoutMilliseconds: number;
  };
  readonly server: {
    readonly version: string;
    readonly protocolVersions: readonly number[];
    /** Extensions this connection answers; empty for a server without any. */
    readonly capabilities: readonly PicaMobileCapability[];
  };
}

/** The answer to a `ping` message. */
export interface PicaMobilePongPayload {
  readonly serverTime: string;
}

/** The structured answer to a message or connection the server rejects. */
export interface PicaMobileErrorPayload {
  readonly code: PicaMobileErrorCode;
  /** English diagnostic text for developers; apps show their own wording. */
  readonly message: string;
  /** Set for `unsupported_version`. */
  readonly supportedVersions?: readonly number[];
  /** Set for `too_many_attempts`. */
  readonly retryAfterSeconds?: number;
}

/** The current avatar image of an account as the dashboard announces it. */
export interface PicaMobileAvatarReference {
  /** Changes with every new image; `avatar_get` names it. */
  readonly version: string;
  readonly mimeType: string;
}

/** The signed-in account as the dashboard shows it. */
export interface PicaMobileDashboardProfile {
  /** Always the identifier of the account the connection authenticated. */
  readonly accountId: string;
  readonly displayName: string;
  /** `null` without a usable image. */
  readonly avatar: PicaMobileAvatarReference | null;
}

/**
 * The result of one dashboard section.
 *
 * @remarks
 * `ready` with no items is a successful empty list; `forbidden` means the
 * account may not read the section and `error` that Pages could not deliver
 * it. The three never stand in for each other.
 */
export type PicaMobileDashboardSection<Item> =
  | { readonly status: "ready"; readonly items: readonly Item[] }
  | { readonly status: "forbidden" | "error" };

/** State of a plan run; `dashboard` delivers only the active ones, `plan` every one. */
export type PicaMobileRunStatus =
  | "running"
  | "pausing"
  | "paused"
  | "stopping"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

/** State of one step of a run. */
export type PicaMobileStepStatus =
  | "waiting"
  | "running"
  | "paused"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

/** One step of a run, numbered the way the server numbers the flow. */
export interface PicaMobileDashboardStep {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly status: PicaMobileStepStatus;
}

/** Steps that belong together: one step, steps side by side, or a loop. */
export interface PicaMobileDashboardStage {
  readonly id: string;
  readonly kind: "step" | "parallel" | "loop";
  readonly steps: readonly PicaMobileDashboardStep[];
}

/** A plan run the signed-in account started; active in `dashboard`, any in `plan`. */
export interface PicaMobileDashboardRun {
  /** Identifier of the run. */
  readonly id: string;
  readonly planId: string;
  readonly name: string;
  /** Key of the one ticket the run works on; absent when it has none or several. */
  readonly ticket?: string;
  readonly startedByAccountId: string;
  readonly status: PicaMobileRunStatus;
  readonly canResume: boolean;
  readonly stages: readonly PicaMobileDashboardStage[];
}

/** Numbers a project reports; every number is one Pages stores or counts. */
export interface PicaMobileProjectProgress {
  readonly percent: number;
  readonly completed: number;
  readonly total: number;
}

/** A project of the signed-in account. */
export interface PicaMobileDashboardProject {
  readonly id: string;
  readonly name: string;
  /** Pages stores project icons as images only, so there is no icon name to send. */
  readonly icon: string | null;
  /** `true` only for a project the account is a member of and may read. */
  readonly assigned: boolean;
  /** `null` while the project has nothing to count. */
  readonly progress: PicaMobileProjectProgress | null;
}

/** The answer to `dashboard_get`. */
export interface PicaMobileDashboardPayload {
  readonly profile: PicaMobileDashboardProfile;
  readonly runs: PicaMobileDashboardSection<PicaMobileDashboardRun>;
  readonly projects: PicaMobileDashboardSection<PicaMobileDashboardProject>;
}

/** The answer to `avatar_get`: the shrunken current image of the signed-in account. */
export interface PicaMobileAvatarPayload extends PicaMobileAvatarReference {
  /** The image bytes in Base64; at most {@link PICA_MOBILE_MAXIMUM_AVATAR_BYTES} decoded. */
  readonly data: string;
}

/**
 * State of a plan in `plans`.
 *
 * @remarks
 * `idle` means the account has no own run of the plan it may read; Pages has
 * no run state `blocked`, so a plan never has it.
 */
export type PicaMobilePlanStatus =
  "idle" | Exclude<PicaMobileRunStatus, "blocked">;

/** The failure of a run as `plans` reports it; neither field ever carries free text. */
export interface PicaMobilePlanError {
  /** A machine code such as `plan_step_failed`; `null` for any other failure content. */
  readonly code: string | null;
  /** Name of the first failed step; `null` when only the run failed. */
  readonly step: string | null;
}

/**
 * A plan with its latest own run, complete.
 *
 * @remarks
 * Every field without a value is absent. Texts are at most
 * {@link PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH} code units long.
 */
export interface PicaMobilePlanRow {
  readonly id: string;
  readonly name: string;
  readonly status: PicaMobilePlanStatus;
  /** The own run; absent for `idle`. */
  readonly runId?: string;
  /** Names of the steps running now, joined with `, `; absent when none runs. */
  readonly step?: string;
  /** Completed steps of the run, without Start, End, decisions and skipped steps. */
  readonly done?: number;
  /** Every step of the run, counted like `done`. */
  readonly total?: number;
  /** Present only when a step or the run failed. */
  readonly error?: PicaMobilePlanError;
  /** ISO-8601 time: end of the run, otherwise its start; absent for `idle`. */
  readonly at?: string;
}

/** A field of a plan row besides its identifier. */
export type PicaMobilePlanRowField = Exclude<keyof PicaMobilePlanRow, "id">;

/**
 * A plan row as a change: the identifier and the fields that changed.
 *
 * @remarks
 * `null` means the field no longer has a value.
 */
export type PicaMobilePlanRowChange = { readonly id: string } & {
  readonly [Field in PicaMobilePlanRowField]?: NonNullable<
    PicaMobilePlanRow[Field]
  > | null;
};

/**
 * The payload of `plans`: the answer to `plans_sync` or a change Pages sends on its own.
 *
 * @remarks
 * With `full` the rows replace the list of the client. Without it `plans`
 * holds new rows in full and changed rows as {@link PicaMobilePlanRowChange},
 * and `removed` names the plans that left the list. Only `seq` means nothing
 * changed.
 */
export interface PicaMobilePlansPayload {
  readonly seq: number;
  readonly full?: true;
  readonly plans?: readonly PicaMobilePlanRowChange[];
  readonly removed?: readonly string[];
}

/**
 * The answer to `plan_get`.
 *
 * @remarks
 * `ok` with `run: null` means the plan belongs to the list but has no own run
 * the account may read; `gone` that the plan does not or no longer belong to it.
 */
export type PicaMobilePlanPayload =
  | {
      readonly planId: string;
      readonly access: "ok";
      readonly run: PicaMobileDashboardRun | null;
    }
  | { readonly planId: string; readonly access: "gone" };

/** Every message the server sends. */
export type PicaMobileServerMessage =
  | PicaMobileEnvelope<"connected", PicaMobileConnectedPayload>
  | PicaMobileEnvelope<"pong", PicaMobilePongPayload>
  | PicaMobileEnvelope<"error", PicaMobileErrorPayload>
  | PicaMobileEnvelope<"dashboard", PicaMobileDashboardPayload>
  | PicaMobileEnvelope<"avatar", PicaMobileAvatarPayload>
  | PicaMobileEnvelope<
      "notification_registered",
      PicaMobileNotificationRegisteredPayload
    >
  | PicaMobileEnvelope<
      "notification_unregistered",
      PicaMobileNotificationUnregisteredPayload
    >
  | PicaMobileEnvelope<"notification_event", PicaMobileNotificationEventPayload>
  | PicaMobileEnvelope<"plans", PicaMobilePlansPayload>
  | PicaMobileEnvelope<"plan", PicaMobilePlanPayload>;
