import {
  PICA_MOBILE_CLIENT_MESSAGE_TYPE,
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_PROTOCOL_VERSION,
  PICA_MOBILE_SERVER_MESSAGE_TYPE,
  PICA_MOBILE_SUPPORTED_VERSIONS,
  picaMobileAuthPayloadSchema,
  picaMobileAvatarGetPayloadSchema,
  picaMobileChatRequestSchema,
  picaMobileDashboardGetPayloadSchema,
  picaMobilePingPayloadSchema,
  picaMobilePlanGetPayloadSchema,
  picaMobilePlansSyncPayloadSchema,
  picaMobileRequestIdSchema,
} from "@/definition/PicaMobileProtocol";

import { parsePicaMobileNotificationPayload } from "./notifications/PicaMobileNotificationMessages";

import type {
  PicaMobileAuthPayload,
  PicaMobileAvatarPayload,
  PicaMobileChatAnswer,
  PicaMobileChatRequest,
  PicaMobileChatRequestType,
  PicaMobileConnectedPayload,
  PicaMobileDashboardPayload,
  PicaMobileErrorCode,
  PicaMobileErrorPayload,
  PicaMobilePlanPayload,
  PicaMobilePlansPayload,
  PicaMobileServerMessage,
} from "@/definition/PicaMobileProtocol";
import type { PicaMobileAuthOutcome } from "./PicaMobileAuthenticator";
import type { PicaMobileNotificationClientMessage } from "./notifications/PicaMobileNotificationMessages";

/** A message of a client that passed every check of the envelope and its payload. */
export type PicaMobileClientMessage =
  | {
      readonly type: "auth";
      readonly requestId: string;
      readonly payload: PicaMobileAuthPayload;
    }
  | { readonly type: "ping"; readonly requestId: string }
  | { readonly type: "dashboard_get"; readonly requestId: string }
  | {
      readonly type: "avatar_get";
      readonly requestId: string;
      readonly payload: { readonly version: string };
    }
  | PicaMobileNotificationClientMessage
  | PicaMobilePlansClientMessage
  | PicaMobileChatClientMessage;

/** A chat request of `chat.v1` or `chat.delete` that passed every check of its payload. */
export type PicaMobileChatClientMessage = PicaMobileChatRequest & {
  readonly requestId: string;
};

/** A message of `plans.v1` that passed every check of its payload. */
export type PicaMobilePlansClientMessage =
  | {
      readonly type: "plans_sync";
      readonly requestId: string;
      readonly payload: { readonly since: number | null };
    }
  | {
      readonly type: "plan_get";
      readonly requestId: string;
      readonly payload: { readonly planId: string };
    };

/** Why a frame is not a usable message, with what the answer needs. */
export interface PicaMobileRejection {
  readonly code: PicaMobileErrorCode;
  readonly message: string;
  /** The request identifier of the rejected frame, when it carried a valid one. */
  readonly requestId: string | null;
  readonly supportedVersions?: readonly number[];
  readonly retryAfterSeconds?: number;
}

/** The outcome of reading one text frame. */
export type PicaMobileParseResult =
  | { readonly ok: true; readonly message: PicaMobileClientMessage }
  | { readonly ok: false; readonly rejection: PicaMobileRejection };

type JsonRecord = Readonly<Record<string, unknown>>;

const CHAT_REQUEST_TYPES: ReadonlySet<string> =
  new Set<PicaMobileChatRequestType>([
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CHAT_OPEN,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CHAT_NEW,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CHAT_SESSIONS,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CHAT_SESSION_GET,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CHAT_STATE,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CHAT_SEND,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CHAT_JOB_GET,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CHAT_STOP,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CHAT_DELETE,
  ]);

function reject(
  code: PicaMobileErrorCode,
  message: string,
  requestId: string | null,
): PicaMobileParseResult {
  return { ok: false, rejection: { code, message, requestId } };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readRequestId(envelope: JsonRecord): string | null {
  const parsed = picaMobileRequestIdSchema.safeParse(envelope.requestId);

  return parsed.success ? parsed.data : null;
}

function rejectVersion(
  version: unknown,
  requestId: string | null,
): PicaMobileParseResult | null {
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return reject(
      PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
      'The field "version" must be an integer.',
      requestId,
    );
  }

  if (PICA_MOBILE_SUPPORTED_VERSIONS.includes(version)) {
    return null;
  }

  return {
    ok: false,
    rejection: {
      code: PICA_MOBILE_ERROR_CODE.UNSUPPORTED_VERSION,
      message: `Protocol version ${version} is not supported.`,
      requestId,
      supportedVersions: PICA_MOBILE_SUPPORTED_VERSIONS,
    },
  };
}

function parseAuthPayload(
  requestId: string,
  payload: unknown,
): PicaMobileParseResult {
  const parsed = picaMobileAuthPayloadSchema.safeParse(payload);

  return parsed.success
    ? {
        ok: true,
        message: { type: "auth", requestId, payload: parsed.data },
      }
    : reject(
        PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
        'The payload of "auth" is invalid.',
        requestId,
      );
}

function parseAvatarGetPayload(
  requestId: string,
  payload: unknown,
): PicaMobileParseResult {
  const parsed = picaMobileAvatarGetPayloadSchema.safeParse(payload);

  return parsed.success
    ? {
        ok: true,
        message: { type: "avatar_get", requestId, payload: parsed.data },
      }
    : reject(
        PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
        'The payload of "avatar_get" needs a "version" of 1 to 64 letters, digits, ".", "_", ":" or "-".',
        requestId,
      );
}

function parsePlansSyncPayload(
  requestId: string,
  payload: unknown,
): PicaMobileParseResult {
  const parsed = picaMobilePlansSyncPayloadSchema.safeParse(payload);

  return parsed.success
    ? {
        ok: true,
        message: { type: "plans_sync", requestId, payload: parsed.data },
      }
    : reject(
        PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
        'The payload of "plans_sync" needs a "since" that is null or an integer of at least 1.',
        requestId,
      );
}

function parsePlanGetPayload(
  requestId: string,
  payload: unknown,
): PicaMobileParseResult {
  const parsed = picaMobilePlanGetPayloadSchema.safeParse(payload);

  return parsed.success
    ? {
        ok: true,
        message: { type: "plan_get", requestId, payload: parsed.data },
      }
    : reject(
        PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
        'The payload of "plan_get" needs a "planId" of 1 to 200 characters.',
        requestId,
      );
}

/** Reads a chat request; `null` when the type belongs to no chat request. */
function parseChatPayload(
  type: string,
  requestId: string,
  payload: JsonRecord,
): PicaMobileParseResult | null {
  if (!CHAT_REQUEST_TYPES.has(type)) {
    return null;
  }

  const parsed = picaMobileChatRequestSchema.safeParse({ type, payload });

  return parsed.success
    ? { ok: true, message: { ...parsed.data, requestId } }
    : reject(
        PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
        `The payload of "${type}" is invalid.`,
        requestId,
      );
}

function parseEmptyPayload(
  type: "ping" | "dashboard_get",
  requestId: string,
  payload: unknown,
): PicaMobileParseResult {
  const schema =
    type === "ping"
      ? picaMobilePingPayloadSchema
      : picaMobileDashboardGetPayloadSchema;

  return schema.safeParse(payload).success
    ? { ok: true, message: { type, requestId } }
    : reject(
        PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
        `The payload of "${type}" must be an object.`,
        requestId,
      );
}

function parsePayload(
  type: string,
  requestId: string,
  payload: JsonRecord,
): PicaMobileParseResult {
  switch (type) {
    case PICA_MOBILE_CLIENT_MESSAGE_TYPE.AUTH:
      return parseAuthPayload(requestId, payload);
    case PICA_MOBILE_CLIENT_MESSAGE_TYPE.PING:
      return parseEmptyPayload("ping", requestId, payload);
    case PICA_MOBILE_CLIENT_MESSAGE_TYPE.DASHBOARD_GET:
      return parseEmptyPayload("dashboard_get", requestId, payload);
    case PICA_MOBILE_CLIENT_MESSAGE_TYPE.AVATAR_GET:
      return parseAvatarGetPayload(requestId, payload);
    case PICA_MOBILE_CLIENT_MESSAGE_TYPE.PLANS_SYNC:
      return parsePlansSyncPayload(requestId, payload);
    case PICA_MOBILE_CLIENT_MESSAGE_TYPE.PLAN_GET:
      return parsePlanGetPayload(requestId, payload);
    default:
      return (
        parsePicaMobileNotificationPayload(type, requestId, payload) ??
        parseChatPayload(type, requestId, payload) ??
        reject(
          PICA_MOBILE_ERROR_CODE.UNKNOWN_TYPE,
          "The message type is not known.",
          requestId,
        )
      );
  }
}

/**
 * Reads one text frame of a client.
 *
 * @param text - Content of the frame.
 * @returns The message, or the reason the frame is rejected. Malformed JSON,
 * a wrong shape, an unsupported version and an unknown type each have their
 * own error code; the frame content is never echoed back.
 */
export function parsePicaMobileMessage(text: string): PicaMobileParseResult {
  const envelope = readJson(text);

  if (!isRecord(envelope)) {
    return reject(
      PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
      "A message must be a JSON object.",
      null,
    );
  }

  const requestId = readRequestId(envelope);
  const versionRejection = rejectVersion(envelope.version, requestId);

  if (versionRejection !== null) {
    return versionRejection;
  }

  if (requestId === null || typeof envelope.type !== "string") {
    return reject(
      PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
      'The fields "type" and "requestId" are required; a request id has 1 to 64 letters, digits, ".", "_", ":" or "-".',
      requestId,
    );
  }

  if (!isRecord(envelope.payload)) {
    return reject(
      PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
      'The field "payload" must be an object.',
      requestId,
    );
  }

  return parsePayload(envelope.type, requestId, envelope.payload);
}

/**
 * Builds the rejection of a failed authentication.
 *
 * @param requestId - Identifier of the `auth` message that is answered.
 * @param outcome - Why the authentication failed.
 * @returns The rejection with its code and, after too many attempts, the wait.
 */
export function describePicaMobileAuthenticationFailure(
  requestId: string,
  outcome: Extract<PicaMobileAuthOutcome, { ok: false }>,
): PicaMobileRejection {
  if (outcome.reason === "tooManyAttempts") {
    return {
      code: PICA_MOBILE_ERROR_CODE.TOO_MANY_ATTEMPTS,
      message: "Too many failed sign-in attempts. Try again later.",
      requestId,
      ...(outcome.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: outcome.retryAfterSeconds }),
    };
  }

  if (outcome.reason === "passwordChangeRequired") {
    return {
      code: PICA_MOBILE_ERROR_CODE.PASSWORD_CHANGE_REQUIRED,
      message: "Change the password in Pages before connecting.",
      requestId,
    };
  }

  return {
    code: PICA_MOBILE_ERROR_CODE.AUTHENTICATION_FAILED,
    message: "The credentials are not valid.",
    requestId,
  };
}

/**
 * Builds the text frame of an error message.
 *
 * @param rejection - Reason, request identifier and hints of the answer.
 * @returns The frame content.
 */
export function encodePicaMobileError(rejection: PicaMobileRejection): string {
  const payload: PicaMobileErrorPayload = {
    code: rejection.code,
    message: rejection.message,
    ...(rejection.supportedVersions === undefined
      ? {}
      : { supportedVersions: rejection.supportedVersions }),
    ...(rejection.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: rejection.retryAfterSeconds }),
  };

  return encode({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.ERROR,
    requestId: rejection.requestId,
    payload,
  });
}

/**
 * Builds the text frame that confirms an authenticated connection.
 *
 * @param requestId - Identifier of the `auth` message that is answered.
 * @param payload - Account, heartbeat and server facts.
 * @returns The frame content.
 */
export function encodePicaMobileConnected(
  requestId: string,
  payload: PicaMobileConnectedPayload,
): string {
  return encode({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.CONNECTED,
    requestId,
    payload,
  });
}

/**
 * Builds the text frame that answers a `ping`.
 *
 * @param requestId - Identifier of the `ping` message that is answered.
 * @param serverTime - Moment the server answers.
 * @returns The frame content.
 */
export function encodePicaMobilePong(
  requestId: string,
  serverTime: Date,
): string {
  return encode({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.PONG,
    requestId,
    payload: { serverTime: serverTime.toISOString() },
  });
}

/**
 * Builds the text frame that answers `dashboard_get`.
 *
 * @param requestId - Identifier of the `dashboard_get` message that is answered.
 * @param payload - Profile, runs and projects of the signed-in account.
 * @returns The frame content.
 */
export function encodePicaMobileDashboard(
  requestId: string,
  payload: PicaMobileDashboardPayload,
): string {
  return encode({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.DASHBOARD,
    requestId,
    payload,
  });
}

/**
 * Builds the text frame that answers `avatar_get`.
 *
 * @param requestId - Identifier of the `avatar_get` message that is answered.
 * @param payload - Version, type and Base64 content of the image.
 * @returns The frame content.
 */
export function encodePicaMobileAvatar(
  requestId: string,
  payload: PicaMobileAvatarPayload,
): string {
  return encode({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.AVATAR,
    requestId,
    payload,
  });
}

/**
 * Builds the text frame of a `plans` message.
 *
 * @param requestId - Identifier of the `plans_sync` that is answered; `null`
 * for a change Pages sends on its own.
 * @param payload - The sequence number with the full list or the change.
 * @returns The frame content.
 */
export function encodePicaMobilePlans(
  requestId: string | null,
  payload: PicaMobilePlansPayload,
): string {
  return encode({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.PLANS,
    requestId,
    payload,
  });
}

/**
 * Builds the text frame that answers `plan_get`.
 *
 * @param requestId - Identifier of the `plan_get` message that is answered.
 * @param payload - The latest own run of the plan, or why there is none.
 * @returns The frame content.
 */
export function encodePicaMobilePlan(
  requestId: string,
  payload: PicaMobilePlanPayload,
): string {
  return encode({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.PLAN,
    requestId,
    payload,
  });
}

/**
 * Builds the text frame of an answer of `chat.v1` or `chat.delete`.
 *
 * @param requestId - Identifier of the chat request that is answered.
 * @param answer - Type and payload of the answer.
 * @returns The frame content.
 */
export function encodePicaMobileChat(
  requestId: string,
  answer: PicaMobileChatAnswer,
): string {
  return encode({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    requestId,
    ...answer,
  });
}

function encode(message: PicaMobileServerMessage): string {
  return JSON.stringify(message);
}
