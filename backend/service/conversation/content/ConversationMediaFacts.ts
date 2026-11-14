import {
  CONVERSATION_MEDIA_MAXIMUM_SECONDS,
  CONVERSATION_MEDIA_MAXIMUM_SIDE,
} from "@/definition/ConversationContent";

import type { StoredConversationMediaFacts } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type {
  ConversationAttachment,
  ConversationAttachmentKind,
} from "@/definition/ConversationContent";

/** The facts as a request names them, before they are checked. */
export interface ConversationMediaFactsInput {
  readonly width?: unknown;
  readonly height?: unknown;
  readonly durationSeconds?: unknown;
}

function readNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string" || input.trim() === "") return null;
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

function readSide(input: unknown): number | null {
  const value = readNumber(input);
  if (value === null || !Number.isInteger(value)) return null;
  return value > 0 && value <= CONVERSATION_MEDIA_MAXIMUM_SIDE ? value : null;
}

function readDurationMs(input: unknown): number | null {
  const value = readNumber(input);
  if (value === null || value <= 0 || value > CONVERSATION_MEDIA_MAXIMUM_SECONDS)
    return null;
  return Math.round(value * 1000);
}

/**
 * Checks the resolution and length the browser read of a video or a sound
 * (PAGE-384).
 *
 * @remarks
 * A video keeps width and height only together; a sound has none. Values
 * outside 1 to 16 384 pixels or beyond one day count as unknown.
 *
 * @param kind - The kind of the attachment.
 * @param input - Width, height and length in seconds as the request names them.
 * @returns The facts to store, or `null` when nothing usable remains or the
 * attachment is neither a video nor a sound.
 */
export function readConversationMediaFacts(
  kind: ConversationAttachmentKind,
  input: ConversationMediaFactsInput,
): StoredConversationMediaFacts | null {
  if (kind !== "video" && kind !== "audio") return null;
  const width = kind === "video" ? readSide(input.width) : null;
  const height = kind === "video" ? readSide(input.height) : null;
  const hasSize = width !== null && height !== null;
  const durationMs = readDurationMs(input.durationSeconds);
  if (!hasSize && durationMs === null) return null;
  return {
    width: hasSize ? width : null,
    height: hasSize ? height : null,
    durationMs,
  };
}

/**
 * The facts of a stored attachment as every client sees them.
 *
 * @param media - The stored facts, or `null`.
 */
export function conversationMediaFactsOf(
  media: StoredConversationMediaFacts | null | undefined,
): Pick<ConversationAttachment, "width" | "height" | "durationSeconds"> {
  if (!media) return {};
  return {
    ...(media.width !== null && media.height !== null
      ? { width: media.width, height: media.height }
      : {}),
    ...(media.durationMs !== null ? { durationSeconds: media.durationMs / 1000 } : {}),
  };
}
