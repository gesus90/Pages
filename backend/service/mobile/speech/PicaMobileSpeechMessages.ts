import {
  PICA_MOBILE_CLIENT_MESSAGE_TYPE,
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_PROTOCOL_VERSION,
} from "@/definition/PicaMobileProtocol";
import { picaMobileSpeechRequestSchema } from "@/definition/PicaMobileSpeech";

import type {
  PicaMobileSpeechAnswer,
  PicaMobileSpeechRequest,
  PicaMobileSpeechRequestType,
} from "@/definition/PicaMobileSpeech";
import type { PicaMobileRejection } from "../PicaMobileMessages";

/** A request of `speech.v1` that passed every check of its payload. */
export type PicaMobileSpeechClientMessage = PicaMobileSpeechRequest & {
  readonly requestId: string;
};

/** The outcome of reading the payload of a speech request. */
export type PicaMobileSpeechParseResult =
  | { readonly ok: true; readonly message: PicaMobileSpeechClientMessage }
  | { readonly ok: false; readonly rejection: PicaMobileRejection };

const SPEECH_REQUEST_TYPES: ReadonlySet<string> =
  new Set<PicaMobileSpeechRequestType>([
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.SPEECH_CONFIG_GET,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.SPEECH_START,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.SPEECH_CHUNK,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.SPEECH_FINISH,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.SPEECH_CANCEL,
  ]);

/**
 * Tells whether a message type belongs to `speech.v1`.
 *
 * @param type - The type of a checked message.
 * @returns `true` for the five speech requests.
 */
export function isPicaMobileSpeechType(type: string): boolean {
  return SPEECH_REQUEST_TYPES.has(type);
}

/**
 * Reads a request of `speech.v1`.
 *
 * @param type - The type of the envelope.
 * @param requestId - The checked request identifier.
 * @param payload - The payload object of the envelope.
 * @returns The message or its rejection; `null` when the type belongs to
 * no speech request.
 */
export function parsePicaMobileSpeechPayload(
  type: string,
  requestId: string,
  payload: Readonly<Record<string, unknown>>,
): PicaMobileSpeechParseResult | null {
  if (!SPEECH_REQUEST_TYPES.has(type)) return null;
  const parsed = picaMobileSpeechRequestSchema.safeParse({ type, payload });
  return parsed.success
    ? { ok: true, message: { ...parsed.data, requestId } }
    : {
        ok: false,
        rejection: {
          code: PICA_MOBILE_ERROR_CODE.INVALID_MESSAGE,
          message: `The payload of "${type}" is invalid.`,
          requestId,
        },
      };
}

/**
 * Builds the text frame of an answer of `speech.v1`.
 *
 * @param requestId - Identifier of the request that is answered; `null`
 * when the server drops a silent recording on its own.
 * @param answer - Type and payload of the answer.
 * @returns The frame content.
 */
export function encodePicaMobileSpeech(
  requestId: string | null,
  answer: PicaMobileSpeechAnswer,
): string {
  return JSON.stringify({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    requestId,
    ...answer,
  });
}
