import { z } from "zod";

import type { SpeechErrorCode, SpeechMimeType } from "./SpeechRecognition";

/** Most decoded bytes one `speech_chunk` carries: 64 KB. */
export const PICA_MOBILE_MAXIMUM_SPEECH_CHUNK_BYTES = 65_536;

/** Longest Base64 text of one `speech_chunk`: 65,536 bytes encoded. */
export const PICA_MOBILE_MAXIMUM_SPEECH_CHUNK_LENGTH = 87_384;

/**
 * Most chunks one recording may have.
 *
 * @remarks
 * More than 25 MB take in chunks of 64 KB, so a recording that grows too
 * large is refused by its size with `too_large`, not by its chunk count;
 * smaller chunks of at least 6.4 KB still reach the 25 MB.
 */
export const PICA_MOBILE_MAXIMUM_SPEECH_CHUNKS = 4096;

/** Recording IDs are chosen by the app; short, printable and safe to echo. */
const speechIdSchema = z.string().regex(/^[\w.:-]{1,64}$/u);

/**
 * The requests of `speech.v1` (PAGE-273), each with its payload.
 *
 * @remarks
 * A recording travels in chunks, because a frame stays within
 * `PICA_MOBILE_MAXIMUM_CHAT_SEND_BYTES`: `speech_start`, then `speech_chunk`
 * with the indexes 0, 1, 2 … and `speech_finish` with the number of chunks.
 * `mimeType` is checked by the server, so any short text passes here and an
 * unknown type is answered with `unsupported_format`.
 */
export const picaMobileSpeechRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("speech_config_get"), payload: z.object({}) }),
  z.object({
    type: z.literal("speech_start"),
    payload: z.object({
      id: speechIdSchema,
      mimeType: z.string().min(1).max(100),
      durationMs: z.number().int().min(0).max(86_400_000),
    }),
  }),
  z.object({
    type: z.literal("speech_chunk"),
    payload: z.object({
      id: speechIdSchema,
      index: z
        .number()
        .int()
        .min(0)
        .max(PICA_MOBILE_MAXIMUM_SPEECH_CHUNKS - 1),
      data: z
        .string()
        .min(1)
        .max(PICA_MOBILE_MAXIMUM_SPEECH_CHUNK_LENGTH)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
    }),
  }),
  z.object({
    type: z.literal("speech_finish"),
    payload: z.object({
      id: speechIdSchema,
      chunkCount: z
        .number()
        .int()
        .min(1)
        .max(PICA_MOBILE_MAXIMUM_SPEECH_CHUNKS),
    }),
  }),
  z.object({
    type: z.literal("speech_cancel"),
    payload: z.object({ id: speechIdSchema }),
  }),
]);

/** A request of `speech.v1` with its checked payload, without the envelope. */
export type PicaMobileSpeechRequest = z.infer<
  typeof picaMobileSpeechRequestSchema
>;

/** The type of a request of `speech.v1`. */
export type PicaMobileSpeechRequestType = PicaMobileSpeechRequest["type"];

/** The answer to `speech_config_get`: the limits that apply now. */
export interface PicaMobileSpeechConfigPayload {
  /** The longest recording: the setting, or the shorter limit of the model. */
  readonly maxDurationMs: number;
  readonly mimeTypes: readonly SpeechMimeType[];
}

/** The text of a finished recording. */
export interface PicaMobileSpeechResultPayload {
  readonly id: string;
  readonly text: string;
}

/** Why a recording gives no text. */
export interface PicaMobileSpeechErrorPayload {
  /** The recording the error belongs to; `null` for `speech_config_get`. */
  readonly id: string | null;
  readonly code: SpeechErrorCode;
}

/** An answer of `speech.v1` without its envelope. */
export type PicaMobileSpeechAnswer =
  | {
      readonly type: "speech_config";
      readonly payload: PicaMobileSpeechConfigPayload;
    }
  | {
      readonly type: "speech_result";
      readonly payload: PicaMobileSpeechResultPayload;
    }
  | {
      readonly type: "speech_error";
      readonly payload: PicaMobileSpeechErrorPayload;
    };
