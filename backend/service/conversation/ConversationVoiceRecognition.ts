import { ConversationError } from "@/backend/error/ConversationError";

import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { ConversationTranscriber } from "./ConversationTranscriber";
import type {
  ConversationVoiceDeclaration,
  ConversationVoiceStore,
} from "./ConversationVoiceStore";

/** What the recognition of a recording is built from. */
export interface ConversationVoiceRecognitionDependencies {
  readonly voices: Pick<
    ConversationVoiceStore,
    "declare" | "store" | "discard"
  >;
  readonly files: Pick<WikiFileStore, "open">;
  readonly transcriber: ConversationTranscriber;
}

/**
 * Turns a recording into text before anything is sent, for a chat whose
 * messages are text alone, such as the direct chat with an agent.
 *
 * @remarks
 * The recording is checked and stored as every voice message is, so the same
 * formats, size and length apply. It is recognized at once and removed
 * again whatever the outcome: only the text goes on.
 */
export class ConversationVoiceRecognition {
  private readonly dependencies: ConversationVoiceRecognitionDependencies;

  public constructor(dependencies: ConversationVoiceRecognitionDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Recognizes the text of a recording.
   *
   * @param declaration - The declared type and length of the recording.
   * @param source - The bytes of the audio.
   * @param maximumCharacters - The longest text the caller takes; a longer
   * one is cut.
   * @returns The recognized text, never empty.
   * @throws {ConversationError} `unsupported_format`, `too_long`, `too_large`
   * or `invalid` for a recording the store refuses, and `invalid` when no
   * text could be recognized.
   */
  public async recognize(
    declaration: ConversationVoiceDeclaration,
    source: AsyncIterable<Uint8Array>,
    maximumCharacters: number,
  ): Promise<string> {
    const { voices, files, transcriber } = this.dependencies;
    const file = await voices.store(voices.declare(declaration), source);
    try {
      const outcome = await transcriber.transcribe({
        open: () => files.open(file.storageName),
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      });
      const text = outcome.ok
        ? Array.from(outcome.text.trim()).slice(0, maximumCharacters).join("")
        : "";
      if (text === "") throw new ConversationError("invalid");
      return text;
    } finally {
      await voices.discard(file);
    }
  }
}
