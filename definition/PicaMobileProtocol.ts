import { z } from "zod";

import type { PicaMobileConversationAnswer } from "./PicaMobileConversations";
import type { PicaMobileSpeechAnswer } from "./PicaMobileSpeech";
import type {
  PicaMobileNotificationEventPayload,
  PicaMobileNotificationRegisteredPayload,
  PicaMobileNotificationSettingsPayload,
  PicaMobileNotificationUnregisteredPayload,
} from "./PicaMobileNotifications";

/** Version of the JSON message format spoken on the Pica Mobile WebSocket. */
export const PICA_MOBILE_PROTOCOL_VERSION = 1;

/** Versions the server accepts in the `version` field of a message. */
export const PICA_MOBILE_SUPPORTED_VERSIONS: readonly number[] = [
  PICA_MOBILE_PROTOCOL_VERSION,
];

/**
 * Largest text frame the server accepts, in UTF-8 bytes.
 *
 * @remarks
 * Before authentication a larger frame closes the connection with 1009; after
 * it a larger frame is refused with `invalid_message`, except `chat_send`,
 * `conversation_send` and `voice_chunk`.
 */
export const PICA_MOBILE_MAXIMUM_MESSAGE_BYTES = 16_384;

/**
 * Largest `chat_send`, `conversation_send`, `voice_chunk` or `speech_chunk`
 * frame the server accepts, in UTF-8 bytes; a larger frame closes the
 * connection.
 */
export const PICA_MOBILE_MAXIMUM_CHAT_SEND_BYTES = 131_072;

/** Longest `chat_*` frame the server sends, in UTF-16 code units. */
export const PICA_MOBILE_MAXIMUM_CHAT_FRAME_LENGTH = 524_288;

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

/** Most iterations of one loop a `plan` lists in `flow`; older ones are only counted. */
export const PICA_MOBILE_MAXIMUM_FLOW_ITERATIONS = 100;

/** Types of the messages a client sends. */
export const PICA_MOBILE_CLIENT_MESSAGE_TYPE = {
  AUTH: "auth",
  PING: "ping",
  DASHBOARD_GET: "dashboard_get",
  AVATAR_GET: "avatar_get",
  NOTIFICATION_REGISTER: "notification_register",
  NOTIFICATION_UNREGISTER: "notification_unregister",
  NOTIFICATION_EVENT_GET: "notification_event_get",
  NOTIFICATION_SETTINGS_GET: "notification_settings_get",
  NOTIFICATION_SETTINGS_SET: "notification_settings_set",
  PLANS_SYNC: "plans_sync",
  PLAN_GET: "plan_get",
  CHAT_OPEN: "chat_open",
  CHAT_NEW: "chat_new",
  CHAT_SESSIONS: "chat_sessions",
  CHAT_SESSION_GET: "chat_session_get",
  CHAT_STATE: "chat_state",
  CHAT_SEND: "chat_send",
  CHAT_JOB_GET: "chat_job_get",
  CHAT_STOP: "chat_stop",
  CHAT_DELETE: "chat_delete",
  CONVERSATIONS_LIST: "conversations_list",
  CONVERSATION_HISTORY: "conversation_history",
  CONVERSATION_PARTICIPANTS: "conversation_participants",
  CONVERSATION_CREATE: "conversation_create",
  CONVERSATION_SEND: "conversation_send",
  CONVERSATION_READ: "conversation_read",
  CONVERSATION_MUTE: "conversation_mute",
  VOICE_START: "voice_start",
  VOICE_CHUNK: "voice_chunk",
  VOICE_FINISH: "voice_finish",
  VOICE_CANCEL: "voice_cancel",
  SPEECH_CONFIG_GET: "speech_config_get",
  SPEECH_START: "speech_start",
  SPEECH_CHUNK: "speech_chunk",
  SPEECH_FINISH: "speech_finish",
  SPEECH_CANCEL: "speech_cancel",
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
  NOTIFICATION_SETTINGS: "notification_settings",
  PLANS: "plans",
  PLAN: "plan",
  CHAT_VIEW: "chat_view",
  CHAT_SESSIONS: "chat_sessions",
  CHAT_STATE: "chat_state",
  CHAT_SENT: "chat_sent",
  CHAT_JOB: "chat_job",
  CHAT_STOPPED: "chat_stopped",
  CHAT_DELETED: "chat_deleted",
  CHAT_FAILED: "chat_failed",
  CONVERSATIONS: "conversations",
  CONVERSATION_MESSAGES: "conversation_messages",
  CONVERSATION_PARTICIPANT_LIST: "conversation_participant_list",
  CONVERSATION_EVENT: "conversation_event",
  CONVERSATION_ERROR: "conversation_error",
  SPEECH_CONFIG: "speech_config",
  SPEECH_RESULT: "speech_result",
  SPEECH_ERROR: "speech_error",
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
 * `notifications.team.v1` stands for `notification_settings_get` and
 * `notification_settings_set` with their answer `notification_settings` and
 * for the pushes about runs of the account's teams; a server names it only
 * together with `notifications.v1`.
 * `plans.v1` stands for `plans_sync` and `plan_get` with their answers and
 * for the `plans` messages the server sends on its own. `chat.v1` stands for
 * the eight `chat_*` requests with their answers and for the attachment
 * endpoints on the same port; the server sends nothing of the chat on its own.
 * `chat.delete` stands for the one request `chat_delete` with its answer
 * `chat_deleted`; a server names it only together with `chat.v1`.
 * `conversations.v1` stands for the stored conversations with people, agents
 * and groups (PAGE-278): the requests `conversations_list`,
 * `conversation_history`, `conversation_participants`, `conversation_create`,
 * `conversation_send`, `conversation_read`, `conversation_mute` and the
 * chunked voice upload `voice_start`, `voice_chunk`, `voice_finish`,
 * `voice_cancel`, with their answers, the `conversation_event` messages the
 * server sends on its own, and the voice endpoint on the same port.
 * `plans.flow.v1` stands for the opt-in `flow` of `plans_sync` and
 * `plan_get` (PAGE-281): the frozen structure of a run with every node, its
 * states, loop iterations, progress and revision in `plan`, and the `state`
 * key in the plan rows; a server names it only together with `plans.v1`.
 * `speech.v1` stands for the speech recognition of the instance (PAGE-273):
 * `speech_config_get` with its answer `speech_config`, and the chunked
 * recording `speech_start`, `speech_chunk`, `speech_finish`, `speech_cancel`
 * with the answers `speech_result` and `speech_error`. A server names it only
 * while a speech model is set up and the account may use Pica.
 */
export const PICA_MOBILE_CAPABILITY = {
  DASHBOARD_V1: "dashboard.v1",
  PLANS_V1: "plans.v1",
  PLANS_FLOW_V1: "plans.flow.v1",
  CHAT_V1: "chat.v1",
  CHAT_DELETE: "chat.delete",
  CONVERSATIONS_V1: "conversations.v1",
  NOTIFICATIONS_V1: "notifications.v1",
  NOTIFICATIONS_PUSH_FCM: "notifications.push.fcm",
  NOTIFICATIONS_TEAM_V1: "notifications.team.v1",
  SPEECH_V1: "speech.v1",
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
 *
 * @remarks
 * `flow: true` (`plans.flow.v1`) asks for the `state` key in every row from
 * this answer on; a client without it gets the rows of `plans.v1` unchanged.
 */
export const picaMobilePlansSyncPayloadSchema = z.object({
  since: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
  flow: z.boolean().optional(),
});

/**
 * A `plan_get` message names the plan whose latest own run the client wants.
 *
 * @remarks
 * `flow: true` (`plans.flow.v1`) asks for the whole structure of the run in
 * `run.flow`; without it the run has the form of `plans.v1`.
 */
export const picaMobilePlanGetPayloadSchema = z.object({
  planId: z.string().min(1).max(PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH),
  flow: z.boolean().optional(),
});

/** Chat session IDs are five lowercase words joined by hyphens. */
const picaMobileChatSessionIdSchema = z
  .string()
  .regex(/^[a-z]{2,12}(?:-[a-z]{2,12}){4}$/u);

/** Message and attachment IDs are short, printable and never a path. */
const picaMobileChatItemIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,100}$/u);

/**
 * The eight requests of `chat.v1` and `chat_delete` of `chat.delete`, each
 * with its payload.
 *
 * @remarks
 * `text` is bounded here by UTF-16 code units only; the chat counts its
 * characters and answers a longer message with `chat_failed`
 * `messageTooLong`, as it does in the web.
 */
export const picaMobileChatRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat_open"), payload: z.object({}) }),
  z.object({ type: z.literal("chat_new"), payload: z.object({}) }),
  z.object({ type: z.literal("chat_sessions"), payload: z.object({}) }),
  z.object({
    type: z.literal("chat_session_get"),
    payload: z.object({
      sessionId: picaMobileChatSessionIdSchema,
      before: picaMobileChatItemIdSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal("chat_state"),
    payload: z.object({ sessionId: picaMobileChatSessionIdSchema }),
  }),
  z.object({
    type: z.literal("chat_send"),
    payload: z.object({
      sessionId: picaMobileChatSessionIdSchema,
      clientMessageId: z.uuid(),
      text: z.string().max(40_000),
      attachmentIds: z.array(picaMobileChatItemIdSchema).max(10),
    }),
  }),
  z.object({
    type: z.literal("chat_job_get"),
    payload: z.object({
      sessionId: picaMobileChatSessionIdSchema,
      jobId: z.string().regex(/^[a-f0-9-]{36}$/u),
      after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    }),
  }),
  z.object({
    type: z.literal("chat_stop"),
    payload: z.object({ sessionId: picaMobileChatSessionIdSchema }),
  }),
  z.object({
    type: z.literal("chat_delete"),
    payload: z.strictObject({ sessionId: picaMobileChatSessionIdSchema }),
  }),
]);

/** A chat request with its checked payload, without the envelope. */
export type PicaMobileChatRequest = z.infer<typeof picaMobileChatRequestSchema>;

/** The type of a chat request. */
export type PicaMobileChatRequestType = PicaMobileChatRequest["type"];

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

/** Kind of a node of a run's flow in `plans.flow.v1`; a client shows an unknown kind as a plain node. */
export type PicaMobileFlowNodeKind =
  | "start"
  | "end"
  | "agent"
  | "script"
  | "closeout"
  | "decision"
  | "stack"
  | "loop";

/** State of a node in `plans.flow.v1`; `skipped` lies on a branch a decision did not take. */
export type PicaMobileFlowStatus = PicaMobileStepStatus | "skipped";

/** A node of a loop iteration with the state it has in that iteration. */
export interface PicaMobileFlowIterationNode {
  readonly id: string;
  readonly status: PicaMobileFlowStatus;
}

/** One iteration a loop actually started, with its own identity `loopId#number`. */
export interface PicaMobileFlowIteration {
  readonly id: string;
  /** Counts from 1. */
  readonly number: number;
  readonly status: PicaMobileFlowStatus;
  /** The nodes the iteration recorded, in the order of the loop's stages. */
  readonly nodes: readonly PicaMobileFlowIterationNode[];
}

/** What a loop resolved and ran; never an iteration that did not start. */
export interface PicaMobileFlowLoop {
  /** The number of iterations resolved once at the loop's start; absent before. */
  readonly count?: {
    readonly limit: number;
    readonly mode: "max" | "expected" | "while";
  };
  /** Why the loop ended regularly; absent while it runs or when it failed. */
  readonly completion?: "count_reached" | "condition_met" | "while_false";
  /** The nodes of one iteration grouped by their step; they carry no state of their own. */
  readonly stages: readonly PicaMobileFlowStage[];
  /** Every iteration the loop started so far. */
  readonly iterationCount: number;
  /** The newest of them, oldest first, at most {@link PICA_MOBILE_MAXIMUM_FLOW_ITERATIONS}. */
  readonly iterations: readonly PicaMobileFlowIteration[];
}

/** A node of the frozen plan revision a run executes. */
export interface PicaMobileFlowNode {
  readonly id: string;
  readonly kind: PicaMobileFlowNodeKind;
  /** Number in the flow as on the plan page; absent for a node inside a loop. */
  readonly number?: number;
  /** Absent for Start, End and a decision without a name. */
  readonly name?: string;
  /** Absent inside the stages of a loop and when the run recorded nothing for the node. */
  readonly status?: PicaMobileFlowStatus;
  /** Whether `progress` counts the node. */
  readonly counted: boolean;
  /** Which start of the node `status` belongs to; present only once it started again. */
  readonly pass?: number;
  /** The output a decision took in its current start. */
  readonly branch?: "true" | "false";
  readonly loop?: PicaMobileFlowLoop;
}

/** Nodes on the same step of the flow; several run side by side. */
export interface PicaMobileFlowStage {
  /** `stage-` and the identifier of the first node. */
  readonly id: string;
  readonly nodes: readonly PicaMobileFlowNode[];
}

/** The complete structure and state of a run in `plans.flow.v1`. */
export interface PicaMobileRunFlow {
  /** Rises with every committed write of the run; a client never replaces a newer one. */
  readonly revision?: number;
  /** Changes exactly when something of the flow changes; the same key as the plan row's `state`. */
  readonly state: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  /** Succeeded and all counted nodes, the same numbers as `done` and `total` of the plan row. */
  readonly progress: { readonly done: number; readonly total: number };
  readonly error?: PicaMobilePlanError;
  readonly stages: readonly PicaMobileFlowStage[];
}

/** A run in `plan`: a run of `plans.v1` and, when asked for, its `flow`. */
export interface PicaMobilePlanRun extends PicaMobileDashboardRun {
  readonly flow?: PicaMobileRunFlow;
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
  /** Key of the visible state of the run (`plans.flow.v1`); absent for `idle` and without `flow`. */
  readonly state?: string;
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
      readonly run: PicaMobilePlanRun | null;
    }
  | { readonly planId: string; readonly access: "gone" };

/** A chat session as `chat.v1` describes it. */
export interface PicaMobileChatSession {
  readonly id: string;
  readonly createdAt: string;
  readonly lastMessageAt: string;
  readonly preview: string;
}

/** A file of a chat message or one uploaded for the next message. */
export interface PicaMobileChatAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  /** `assistant` for a file Pica attached to its answer. */
  readonly origin?: "assistant";
}

/** A stored message of a chat session. */
export interface PicaMobileChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly attachments: readonly PicaMobileChatAttachment[];
  /** The person stopped this answer of Pica before it ended. */
  readonly isStopped?: true;
  /** `content` was shortened so the frame stays within its limit. */
  readonly isCut?: true;
}

/** State of a Pica job. */
export type PicaMobileChatJobState =
  "running" | "completed" | "failed" | "stopped" | "interrupted";

/** What became of a message sent while Pica was answering. */
export type PicaMobileChatSteerStatus =
  "pending" | "delivered" | "accepted" | "followUp" | "failed";

/** The newest job of a session, without its journal. */
export interface PicaMobileChatJobSummary {
  readonly id: string;
  readonly state: PicaMobileChatJobState;
  readonly errorCode: string | null;
}

/**
 * The answer to `chat_open`, `chat_new` and `chat_session_get`.
 *
 * @remarks
 * `messages` holds the newest page, oldest first: at most 30 messages and
 * 400000 characters, but always at least one message when the session has
 * any. `attachmentLimitBytes` belongs to `chat_open`.
 */
export interface PicaMobileChatViewPayload {
  readonly session: PicaMobileChatSession;
  readonly messages: readonly PicaMobileChatMessage[];
  /** Older messages exist; `chat_session_get` with `before` reads them. */
  readonly hasOlder: boolean;
  /** Attachments uploaded for the next message and not sent yet. */
  readonly pending: readonly PicaMobileChatAttachment[];
  readonly job: PicaMobileChatJobSummary | null;
  readonly steers: readonly {
    readonly messageId: string;
    readonly status: PicaMobileChatSteerStatus;
  }[];
  readonly attachmentLimitBytes?: number;
}

/** The answer to `chat_sessions`: at most 200 sessions, newest first. */
export interface PicaMobileChatSessionsPayload {
  readonly sessions: readonly {
    readonly id: string;
    readonly lastMessageAt: string;
    /** At most 120 characters. */
    readonly preview: string;
  }[];
}

/** The answer to `chat_state`; without a job the last two fields are `null`. */
export interface PicaMobileChatStatePayload {
  readonly sessionId: string;
  readonly lastMessageAt: string;
  readonly jobId: string | null;
  readonly jobState: PicaMobileChatJobState | null;
}

/** The answer to `chat_send`: the job the message started or the steer it joined. */
export type PicaMobileChatSentPayload =
  | { readonly kind: "job"; readonly messageId: string; readonly jobId: string }
  | {
      readonly kind: "steer";
      readonly messageId: string;
      readonly jobId: string;
      readonly status: PicaMobileChatSteerStatus;
    };

/** A journal entry `chat_job` transfers; every other entry stays out. */
export type PicaMobileChatJobEvent =
  | {
      readonly kind: "turn";
      readonly turn: number;
      readonly origin: "message" | "followUp";
      readonly startedAt?: string;
    }
  | {
      readonly kind: "text";
      readonly turn: number;
      readonly isReset: boolean;
      readonly delta: string;
    }
  | {
      readonly kind: "steer";
      readonly messageId: string;
      readonly status: PicaMobileChatSteerStatus;
    }
  | {
      readonly kind: "answer";
      readonly turn: number;
      readonly messageId: string;
    }
  | {
      readonly kind: "end";
      readonly state: Exclude<PicaMobileChatJobState, "running">;
      readonly errorCode: string | null;
    };

/**
 * The answer to `chat_job_get`.
 *
 * @remarks
 * `cursor` counts every journal entry read, also the ones left out; a page
 * holds at most 200 entries and 200000 characters, otherwise `hasMore` is
 * `true`. `{ jobId: null }` means the session has no such job.
 */
export type PicaMobileChatJobPayload =
  | {
      readonly jobId: string;
      readonly state: PicaMobileChatJobState;
      readonly errorCode: string | null;
      readonly cursor: number;
      readonly hasMore: boolean;
      readonly events: readonly {
        readonly sequence: number;
        readonly event: PicaMobileChatJobEvent;
      }[];
    }
  | { readonly jobId: null };

/**
 * An answer of `chat.v1` or `chat.delete` without its envelope.
 *
 * @remarks
 * `chat_failed` carries a code of the chat, such as `sessionMissing` or
 * `messageTooLong`, never a text.
 */
export type PicaMobileChatAnswer =
  | { readonly type: "chat_view"; readonly payload: PicaMobileChatViewPayload }
  | {
      readonly type: "chat_sessions";
      readonly payload: PicaMobileChatSessionsPayload;
    }
  | {
      readonly type: "chat_state";
      readonly payload: PicaMobileChatStatePayload;
    }
  | { readonly type: "chat_sent"; readonly payload: PicaMobileChatSentPayload }
  | { readonly type: "chat_job"; readonly payload: PicaMobileChatJobPayload }
  | {
      readonly type: "chat_stopped";
      readonly payload: { readonly sessionId: string };
    }
  | {
      readonly type: "chat_deleted";
      readonly payload: { readonly sessionId: string };
    }
  | {
      readonly type: "chat_failed";
      readonly payload: { readonly code: string };
    };

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
  | PicaMobileEnvelope<
      "notification_settings",
      PicaMobileNotificationSettingsPayload
    >
  | PicaMobileEnvelope<"plans", PicaMobilePlansPayload>
  | PicaMobileEnvelope<"plan", PicaMobilePlanPayload>
  | (PicaMobileChatAnswer & {
      readonly version: typeof PICA_MOBILE_PROTOCOL_VERSION;
      readonly requestId: string;
    })
  | (PicaMobileConversationAnswer & {
      readonly version: typeof PICA_MOBILE_PROTOCOL_VERSION;
      /** `null` for an event Pages sends on its own. */
      readonly requestId: string | null;
    })
  | (PicaMobileSpeechAnswer & {
      readonly version: typeof PICA_MOBILE_PROTOCOL_VERSION;
      /** `null` when the server drops a silent recording on its own. */
      readonly requestId: string | null;
    });
