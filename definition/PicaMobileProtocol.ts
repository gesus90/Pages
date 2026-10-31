import { z } from "zod";

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

/** Types of the messages a client sends. */
export const PICA_MOBILE_CLIENT_MESSAGE_TYPE = {
  AUTH: "auth",
  PING: "ping",
  DASHBOARD_GET: "dashboard_get",
  AVATAR_GET: "avatar_get",
} as const;

/** Types of the messages the server sends. */
export const PICA_MOBILE_SERVER_MESSAGE_TYPE = {
  CONNECTED: "connected",
  PONG: "pong",
  ERROR: "error",
  DASHBOARD: "dashboard",
  AVATAR: "avatar",
} as const;

/**
 * Extensions of version 1 that a server announces in `connected`.
 *
 * @remarks
 * `dashboard.v1` stands for the whole dashboard contract: `dashboard_get`,
 * `dashboard`, `avatar_get` and `avatar`. A server names it only for a
 * connection that answers all of them.
 */
export const PICA_MOBILE_CAPABILITY = {
  DASHBOARD_V1: "dashboard.v1",
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

/** State of a plan run; Pages delivers only the active ones. */
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

/** An active plan run the signed-in account started. */
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

/** Every message the server sends. */
export type PicaMobileServerMessage =
  | PicaMobileEnvelope<"connected", PicaMobileConnectedPayload>
  | PicaMobileEnvelope<"pong", PicaMobilePongPayload>
  | PicaMobileEnvelope<"error", PicaMobileErrorPayload>
  | PicaMobileEnvelope<"dashboard", PicaMobileDashboardPayload>
  | PicaMobileEnvelope<"avatar", PicaMobileAvatarPayload>;
