import { ConversationError } from "@/backend/error/ConversationError";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import {
  CONVERSATION_VOICE_DEFAULT_DURATION_SECONDS,
  CONVERSATION_VOICE_MAXIMUM_BYTES,
} from "@/definition/Conversation";

import {
  readAudioFacts,
  readVoiceFormat,
  voiceMimeType,
} from "./ConversationAudioFormat";

import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { ConversationVoiceFormat } from "@/definition/Conversation";

/** A header may state a little more than the recorder measured. */
const DURATION_TOLERANCE_MILLISECONDS = 1_000;

/** Why stored audio is refused, or `null` when it is kept. */
function refusalOf(
  isDeclaredFormat: boolean,
  duration: { readonly durationMs: number; readonly maximumMs: number },
): "unsupported_format" | "too_long" | null {
  if (!isDeclaredFormat) return "unsupported_format";
  const limit = duration.maximumMs + DURATION_TOLERANCE_MILLISECONDS;
  return duration.durationMs > limit ? "too_long" : null;
}

/** The declared facts of a voice message before its audio arrives. */
export interface ConversationVoiceDeclaration {
  readonly mimeType: string;
  readonly durationMs: number;
}

/** The checked declaration of a voice message. */
export interface ConversationVoiceIntent {
  readonly format: ConversationVoiceFormat;
  readonly durationMs: number;
}

/** An audio file in the store whose content was checked. */
export interface StoredConversationVoiceFile {
  readonly storageName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
}

/**
 * Checks and keeps the audio of voice messages in the file store of Pages
 * (PAGE-278).
 *
 * @remarks
 * Only WAV and MP3 are accepted, at most 25 MB and the longest recording of
 * Pages. The format is decided from the content, which must match the
 * declared type; the length of a WAV is read from its header, that of an MP3
 * is the declared one. A refused file leaves nothing behind.
 */
export class ConversationVoiceStore {
  private readonly files: Pick<WikiFileStore, "write" | "remove">;
  private readonly maximumDurationMs: number;

  /**
   * Creates the store.
   *
   * @param files - The directory of the audio files.
   * @param maximumDurationMs - The longest recording Pages is set to
   * (PAGE-277); 300 seconds by default.
   */
  public constructor(
    files: Pick<WikiFileStore, "write" | "remove">,
    maximumDurationMs = CONVERSATION_VOICE_DEFAULT_DURATION_SECONDS * 1000,
  ) {
    this.files = files;
    this.maximumDurationMs = maximumDurationMs;
  }

  /**
   * Checks the declared type and length before any audio is taken.
   *
   * @throws {ConversationError} `unsupported_format` for a type that is
   * neither WAV nor MP3, `too_long` beyond the longest recording, `invalid`
   * for a length that is no positive whole number.
   */
  public declare(
    declaration: ConversationVoiceDeclaration,
  ): ConversationVoiceIntent {
    const format = readVoiceFormat(declaration.mimeType);
    if (format === null) throw new ConversationError("unsupported_format");
    if (
      !Number.isSafeInteger(declaration.durationMs) ||
      declaration.durationMs < 1
    )
      throw new ConversationError("invalid");
    if (declaration.durationMs > this.maximumDurationMs)
      throw new ConversationError("too_long");
    return { format, durationMs: declaration.durationMs };
  }

  /**
   * Streams the audio to the store and checks what arrived.
   *
   * @param intent - The checked declaration.
   * @param source - The bytes of the audio.
   * @returns The stored file with its checked facts.
   * @throws {ConversationError} `too_large` beyond 25 MB, `unsupported_format`
   * for content that does not match the declared format, `too_long` for a
   * header that states a longer recording.
   */
  public async store(
    intent: ConversationVoiceIntent,
    source: AsyncIterable<Uint8Array>,
  ): Promise<StoredConversationVoiceFile> {
    let head = Buffer.alloc(0);
    let stored: Awaited<ReturnType<WikiFileStore["write"]>>;
    try {
      stored = await this.files.write(source, {
        absoluteLimit: CONVERSATION_VOICE_MAXIMUM_BYTES,
        limitFor: (start) => {
          head = Buffer.from(start);
          return CONVERSATION_VOICE_MAXIMUM_BYTES;
        },
      });
    } catch (error: unknown) {
      if (error instanceof FileTooLargeError)
        throw new ConversationError("too_large");
      throw error;
    }
    const facts = readAudioFacts(head, stored.size);
    const durationMs = facts?.durationMs ?? intent.durationMs;
    const refusal = refusalOf(facts?.format === intent.format, {
      durationMs,
      maximumMs: this.maximumDurationMs,
    });
    if (refusal !== null) {
      await this.files.remove([stored.storageName]);
      throw new ConversationError(refusal);
    }
    return {
      storageName: stored.storageName,
      mimeType: voiceMimeType(intent.format),
      sizeBytes: stored.size,
      durationMs: Math.max(1, durationMs),
    };
  }

  /**
   * Removes stored audio that no message refers to.
   *
   * @param file - The stored file.
   */
  public async discard(file: StoredConversationVoiceFile): Promise<void> {
    await this.files.remove([file.storageName]);
  }
}
