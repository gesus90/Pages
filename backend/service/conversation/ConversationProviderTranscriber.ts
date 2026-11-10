import { readFile } from "node:fs/promises";

import { logEvent } from "@/backend/logging/Logger";

import type {
  ConversationTranscriber,
  ConversationTranscriptionInput,
  ConversationTranscriptionOutcome,
} from "./ConversationTranscriber";
import type { Readable } from "node:stream";

/** The speech model and where it runs. */
export interface ConversationSpeechModel {
  readonly model: string;
  /** The OpenAI-compatible transcription endpoint. */
  readonly url: string;
  /** The file that holds the API key; `null`: no key is sent. */
  readonly apiKeyFile: string | null;
}

const COMPONENT = "ConversationProviderTranscriber";
/** A recognition of five minutes of audio rarely takes a minute; two are generous. */
const REQUEST_TIMEOUT_MILLISECONDS = 120_000;

async function readAudio(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks);
}

function readTranscript(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("text" in body))
    return null;
  return typeof body.text === "string" ? body.text : null;
}

function fileName(mimeType: string): string {
  return mimeType === "audio/mpeg" ? "voice.mp3" : "voice.wav";
}

/**
 * The recognition with the speech model of the server setting (PAGE-277): the
 * audio goes as `multipart/form-data` to an OpenAI-compatible
 * `/audio/transcriptions` endpoint, which answers `{ "text": … }`.
 *
 * @remarks
 * The key is read from its file for every recognition and never logged. A
 * failed request, a refusal or an answer without text counts as failed; the
 * audio stays playable.
 */
export class ConversationProviderTranscriber implements ConversationTranscriber {
  private readonly speech: ConversationSpeechModel;

  /**
   * Creates the recognition.
   *
   * @param speech - The model, its endpoint and the key file.
   */
  public constructor(speech: ConversationSpeechModel) {
    this.speech = speech;
  }

  /** Sends the audio to the speech model and returns its text. */
  public async transcribe(
    input: ConversationTranscriptionInput,
  ): Promise<ConversationTranscriptionOutcome> {
    try {
      const response = await this.request(input);
      if (!response.ok) {
        this.logFailure("refused", { status: response.status });
        return { ok: false };
      }
      const text = readTranscript(await response.json());
      if (text === null || text.trim() === "") {
        this.logFailure("empty", {});
        return { ok: false };
      }
      return { ok: true, text };
    } catch (error: unknown) {
      this.logFailure("request_failed", {}, error);
      return { ok: false };
    }
  }

  private async request(
    input: ConversationTranscriptionInput,
  ): Promise<Response> {
    const audio = await readAudio(input.open());
    const form = new FormData();
    form.set("model", this.speech.model);
    form.set(
      "file",
      new Blob([new Uint8Array(audio)], { type: input.mimeType }),
      fileName(input.mimeType),
    );
    const headers = new Headers();
    if (this.speech.apiKeyFile !== null) {
      const key = (await readFile(this.speech.apiKeyFile, "utf8")).trim();
      headers.set("Authorization", `Bearer ${key}`);
    }
    return fetch(this.speech.url, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
  }

  private logFailure(
    reason: string,
    metadata: Readonly<Record<string, number>>,
    error?: unknown,
  ): void {
    logEvent({
      level: "warn",
      event: "conversation.transcription.failed",
      component: COMPONENT,
      message: "The speech model did not recognize the voice message",
      metadata: { reason, model: this.speech.model, ...metadata },
      ...(error === undefined ? {} : { error }),
    });
  }
}
