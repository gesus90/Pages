import {
  PICA_MOBILE_CLIENT_MESSAGE_TYPE,
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_PROTOCOL_VERSION,
  PICA_MOBILE_SERVER_MESSAGE_TYPE,
} from "@/definition/PicaMobileProtocol";
import {
  PICA_MOBILE_NOTIFICATION_PLATFORM,
  PICA_MOBILE_NOTIFICATION_PROVIDER,
  picaMobileNotificationEventGetPayloadSchema,
  picaMobileNotificationIdSchema,
  picaMobileNotificationPreviewSchema,
  picaMobileNotificationUnregisterPayloadSchema,
  picaMobilePushTokenSchema,
} from "@/definition/PicaMobileNotifications";

import type {
  PicaMobileNotificationEventPayload,
  PicaMobileNotificationLocale,
  PicaMobileNotificationPreview,
  PicaMobileNotificationRegisteredPayload,
  PicaMobileNotificationUnregisteredPayload,
} from "@/definition/PicaMobileNotifications";
import type { PicaMobileRejection } from "../PicaMobileMessages";

/** A notification message of a client that passed every check of its payload. */
export type PicaMobileNotificationClientMessage =
  | {
      readonly type: "notification_register";
      readonly requestId: string;
      readonly payload: {
        readonly deviceId: string;
        readonly token: string;
        readonly locale: PicaMobileNotificationLocale;
        readonly preview: PicaMobileNotificationPreview;
      };
    }
  | {
      readonly type: "notification_unregister";
      readonly requestId: string;
      readonly payload: { readonly deviceId: string };
    }
  | {
      readonly type: "notification_event_get";
      readonly requestId: string;
      readonly payload: { readonly eventId: string };
    };

/** The outcome of reading the payload of a notification message. */
export type PicaMobileNotificationParseResult =
  | {
      readonly ok: true;
      readonly message: PicaMobileNotificationClientMessage;
    }
  | { readonly ok: false; readonly rejection: PicaMobileRejection };

function invalid(
  requestId: string,
  message: string,
): PicaMobileNotificationParseResult {
  return {
    ok: false,
    rejection: {
      code: PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
      message,
      requestId,
    },
  };
}

type JsonRecord = Readonly<Record<string, unknown>>;

function readRegisterFields(
  requestId: string,
  payload: JsonRecord,
): PicaMobileNotificationParseResult {
  const deviceId = picaMobileNotificationIdSchema.safeParse(payload.deviceId);
  const token = picaMobilePushTokenSchema.safeParse(payload.token);

  if (!deviceId.success) {
    return invalid(
      requestId,
      'The payload of "notification_register" needs a "deviceId" of 16 to 64 letters, digits, "_" or "-".',
    );
  }

  if (payload.platform !== PICA_MOBILE_NOTIFICATION_PLATFORM) {
    return invalid(
      requestId,
      `Only the platform "${PICA_MOBILE_NOTIFICATION_PLATFORM}" is supported.`,
    );
  }

  if (payload.provider !== PICA_MOBILE_NOTIFICATION_PROVIDER) {
    return invalid(
      requestId,
      `Only the provider "${PICA_MOBILE_NOTIFICATION_PROVIDER}" is supported.`,
    );
  }

  if (!token.success) {
    return invalid(
      requestId,
      'The payload of "notification_register" needs a "token" of 1 to 4096 characters without white space.',
    );
  }

  const preview =
    payload.preview === undefined
      ? ({ success: true, data: "hidden" } as const)
      : picaMobileNotificationPreviewSchema.safeParse(payload.preview);

  if (!preview.success) {
    return invalid(
      requestId,
      'The "preview" of "notification_register" must be "hidden" or "details".',
    );
  }

  return {
    ok: true,
    message: {
      type: "notification_register",
      requestId,
      payload: {
        deviceId: deviceId.data,
        token: token.data,
        // An unknown language falls back to German, as the contract says.
        locale: payload.locale === "en" ? "en" : "de",
        preview: preview.data,
      },
    },
  };
}

/**
 * Reads the payload of a notification message.
 *
 * @param type - The `type` of the message.
 * @param requestId - The valid request identifier of the message.
 * @param payload - The payload object.
 * @returns The message, the reason it is rejected, or `null` when the type is
 * not a notification message at all.
 */
export function parsePicaMobileNotificationPayload(
  type: string,
  requestId: string,
  payload: JsonRecord,
): PicaMobileNotificationParseResult | null {
  switch (type) {
    case PICA_MOBILE_CLIENT_MESSAGE_TYPE.NOTIFICATION_REGISTER:
      return readRegisterFields(requestId, payload);
    case PICA_MOBILE_CLIENT_MESSAGE_TYPE.NOTIFICATION_UNREGISTER: {
      const parsed =
        picaMobileNotificationUnregisterPayloadSchema.safeParse(payload);

      return parsed.success
        ? {
            ok: true,
            message: {
              type: "notification_unregister",
              requestId,
              payload: parsed.data,
            },
          }
        : invalid(
            requestId,
            'The payload of "notification_unregister" needs a "deviceId" of 16 to 64 letters, digits, "_" or "-".',
          );
    }
    case PICA_MOBILE_CLIENT_MESSAGE_TYPE.NOTIFICATION_EVENT_GET: {
      const parsed =
        picaMobileNotificationEventGetPayloadSchema.safeParse(payload);

      return parsed.success
        ? {
            ok: true,
            message: {
              type: "notification_event_get",
              requestId,
              payload: parsed.data,
            },
          }
        : invalid(
            requestId,
            'The payload of "notification_event_get" needs an "eventId" of 16 to 64 letters, digits, "_" or "-".',
          );
    }
    default:
      return null;
  }
}

/**
 * Builds the text frame that answers `notification_register`.
 *
 * @param requestId - Identifier of the message that is answered.
 * @param payload - Device, instance, account, start and replay time.
 * @returns The frame content.
 */
export function encodePicaMobileNotificationRegistered(
  requestId: string,
  payload: PicaMobileNotificationRegisteredPayload,
): string {
  return JSON.stringify({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.NOTIFICATION_REGISTERED,
    requestId,
    payload,
  });
}

/**
 * Builds the text frame that answers `notification_unregister`.
 *
 * @param requestId - Identifier of the message that is answered.
 * @param payload - The device that was named.
 * @returns The frame content.
 */
export function encodePicaMobileNotificationUnregistered(
  requestId: string,
  payload: PicaMobileNotificationUnregisteredPayload,
): string {
  return JSON.stringify({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.NOTIFICATION_UNREGISTERED,
    requestId,
    payload,
  });
}

/**
 * Builds the text frame that answers `notification_event_get`.
 *
 * @param requestId - Identifier of the message that is answered.
 * @param payload - The event with its access state.
 * @returns The frame content.
 */
export function encodePicaMobileNotificationEvent(
  requestId: string,
  payload: PicaMobileNotificationEventPayload,
): string {
  return JSON.stringify({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    type: PICA_MOBILE_SERVER_MESSAGE_TYPE.NOTIFICATION_EVENT,
    requestId,
    payload,
  });
}
