import {
  PICA_MOBILE_CLIENT_MESSAGE_TYPE,
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_PROTOCOL_VERSION,
  PICA_MOBILE_SERVER_MESSAGE_TYPE,
  PICA_MOBILE_SUPPORTED_VERSIONS,
  picaMobileAuthPayloadSchema,
  picaMobilePingPayloadSchema,
  picaMobileRequestIdSchema,
} from "@/definition/PicaMobileProtocol";

import type {
  PicaMobileAuthPayload,
  PicaMobileConnectedPayload,
  PicaMobileErrorCode,
  PicaMobileErrorPayload,
  PicaMobileServerMessage,
} from "@/definition/PicaMobileProtocol";

/** A message of a client that passed every check of the envelope and its payload. */
export type PicaMobileClientMessage =
  | {
      readonly type: "auth";
      readonly requestId: string;
      readonly payload: PicaMobileAuthPayload;
    }
  | { readonly type: "ping"; readonly requestId: string };

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

function parsePayload(
  type: string,
  requestId: string,
  payload: unknown,
): PicaMobileParseResult {
  if (type === PICA_MOBILE_CLIENT_MESSAGE_TYPE.AUTH) {
    const parsed = picaMobileAuthPayloadSchema.safeParse(payload);

    return parsed.success
      ? { ok: true, message: { type, requestId, payload: parsed.data } }
      : reject(
          PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
          'The payload of "auth" is invalid.',
          requestId,
        );
  }

  if (type === PICA_MOBILE_CLIENT_MESSAGE_TYPE.PING) {
    return picaMobilePingPayloadSchema.safeParse(payload).success
      ? { ok: true, message: { type, requestId } }
      : reject(
          PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
          'The payload of "ping" must be an object.',
          requestId,
        );
  }

  return reject(
    PICA_MOBILE_ERROR_CODE.UNKNOWN_TYPE,
    "The message type is not known.",
    requestId,
  );
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

function encode(message: PicaMobileServerMessage): string {
  return JSON.stringify(message);
}
