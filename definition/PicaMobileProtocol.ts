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

/** Types of the messages a client sends. */
export const PICA_MOBILE_CLIENT_MESSAGE_TYPE = {
  AUTH: "auth",
  PING: "ping",
} as const;

/** Types of the messages the server sends. */
export const PICA_MOBILE_SERVER_MESSAGE_TYPE = {
  CONNECTED: "connected",
  PONG: "pong",
  ERROR: "error",
} as const;

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

/** Every message the server sends. */
export type PicaMobileServerMessage =
  | PicaMobileEnvelope<"connected", PicaMobileConnectedPayload>
  | PicaMobileEnvelope<"pong", PicaMobilePongPayload>
  | PicaMobileEnvelope<"error", PicaMobileErrorPayload>;
