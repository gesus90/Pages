import { CONVERSATION_VOICE_MIME_TYPES } from "@/definition/Conversation";

import type { ConversationVoiceFormat } from "@/definition/Conversation";

/** What the start of an audio file tells. */
export interface ConversationAudioFacts {
  readonly format: ConversationVoiceFormat;
  /** The length the file header states; `null` when the header does not tell it. */
  readonly durationMs: number | null;
}

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const WAVE_BYTE_RATE_OFFSET = 8;

/**
 * Reads the audio format a declared MIME type names.
 *
 * @param mimeType - The type the client declared, parameters allowed.
 * @returns The format, or `null` for a type that is neither WAV nor MP3.
 */
export function readVoiceFormat(
  mimeType: string,
): ConversationVoiceFormat | null {
  const essence = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (CONVERSATION_VOICE_MIME_TYPES.wav.some((type) => type === essence))
    return "wav";
  if (CONVERSATION_VOICE_MIME_TYPES.mp3.some((type) => type === essence))
    return "mp3";
  return null;
}

/** The canonical MIME type a format is delivered with. */
export function voiceMimeType(format: ConversationVoiceFormat): string {
  return format === "wav" ? "audio/wav" : "audio/mpeg";
}

/** The duration a WAV header states: data bytes divided by bytes per second. */
function readWaveDuration(head: Buffer, size: number): number | null {
  let offset = RIFF_HEADER_BYTES;
  let byteRate: number | null = null;
  while (offset + CHUNK_HEADER_BYTES <= head.length) {
    const id = head.toString("latin1", offset, offset + 4);
    const length = head.readUInt32LE(offset + 4);
    const body = offset + CHUNK_HEADER_BYTES;
    if (id === "fmt " && body + WAVE_BYTE_RATE_OFFSET + 4 <= head.length)
      byteRate = head.readUInt32LE(body + WAVE_BYTE_RATE_OFFSET);
    if (id === "data") {
      if (byteRate === null || byteRate === 0) return null;
      // A recorder that streams writes an unknown length; the file size tells it then.
      const dataBytes = Math.min(length, size - body);
      return Math.round((dataBytes / byteRate) * 1000);
    }
    offset = body + length + (length % 2);
  }
  return null;
}

/** Whether the bytes start with an MPEG audio frame of layer III. */
function isMpegLayerThreeFrame(head: Buffer, offset: number): boolean {
  const first = head[offset];
  const second = head[offset + 1];
  if (first === undefined || second === undefined) return false;
  // Eleven sync bits, then version (not reserved) and layer III.
  return (
    first === 0xff &&
    (second & 0xe0) === 0xe0 &&
    (second & 0x06) === 0x02 &&
    (second & 0x18) !== 0x08
  );
}

function isMp3(head: Buffer): boolean {
  return (
    head.toString("latin1", 0, 3) === "ID3" || isMpegLayerThreeFrame(head, 0)
  );
}

function isWave(head: Buffer): boolean {
  return (
    head.length >= RIFF_HEADER_BYTES &&
    head.toString("latin1", 0, 4) === "RIFF" &&
    head.toString("latin1", 8, 12) === "WAVE"
  );
}

/**
 * Reads the format and, for WAV, the length from the start of an audio file.
 *
 * @param head - The first bytes of the file.
 * @param size - The size of the whole file in bytes.
 * @returns The facts, or `null` when the bytes are neither WAV nor MP3.
 *
 * @remarks
 * The length of an MP3 is not read: a file of variable bit rate tells it
 * only through its whole content, so the declared length stands for it.
 */
export function readAudioFacts(
  head: Buffer,
  size: number,
): ConversationAudioFacts | null {
  if (isWave(head))
    return { format: "wav", durationMs: readWaveDuration(head, size) };
  if (isMp3(head)) return { format: "mp3", durationMs: null };
  return null;
}
