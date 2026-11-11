import { logEvent } from "@/backend/logging/Logger";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import type { SpeechMimeType } from "@/definition/SpeechRecognition";

/** The providers Pages recognizes speech with; no other connection offers it. */
export type SpeechProviderId = "openrouter" | "zai";

/** One recognition request to a provider. */
export interface SpeechProviderRequest {
  readonly provider: SpeechProviderId;
  readonly apiKey: string;
  readonly model: string;
  /** The recording, held in memory only and never logged. */
  readonly audio: Buffer;
  readonly mimeType: SpeechMimeType;
  readonly signal: AbortSignal;
}

/** What a provider made of a recording. */
export type SpeechProviderOutcome =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly code: "provider_failed" | "provider_unreachable";
    };

/** Z.AI's documented transcription endpoint for `glm-asr-2512`. */
const ZAI_TRANSCRIPTION_URL =
  "https://api.z.ai/api/paas/v4/audio/transcriptions";

/** OpenRouter's dedicated speech-to-text endpoint (PAGE-294). */
const OPENROUTER_TRANSCRIPTION_URL = `${AGENT_PROVIDERS.openrouter.endpoint}/audio/transcriptions`;

/** How long a provider may take for one recording. */
const REQUEST_TIMEOUT_MS = 90_000;

/** The largest answer Pages reads. */
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;

const COMPONENT = "SpeechProviderClient";

const FAILED: SpeechProviderOutcome = { ok: false, code: "provider_failed" };
const UNREACHABLE: SpeechProviderOutcome = {
  ok: false,
  code: "provider_unreachable",
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// No `language` is sent, so the model detects the spoken language itself.
function openRouterRequest(request: SpeechProviderRequest): RequestInit {
  return {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      input_audio: {
        data: request.audio.toString("base64"),
        format: request.mimeType === "audio/wav" ? "wav" : "mp3",
      },
      response_format: "json",
    }),
  };
}

function zaiRequest(request: SpeechProviderRequest): RequestInit {
  const form = new FormData();
  form.set("model", request.model);
  form.set("stream", "false");
  form.set(
    "file",
    new Blob([new Uint8Array(request.audio)], { type: request.mimeType }),
    request.mimeType === "audio/wav" ? "audio.wav" : "audio.mp3",
  );
  return {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: form,
  };
}

// Both transcription APIs answer with the recognized text in the string field `text`.
function readTranscriptionText(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.text === "string"
    ? payload.text
    : null;
}

async function readBody(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (
      let chunk = await reader.read();
      !chunk.done;
      chunk = await reader.read()
    ) {
      bytes += chunk.value.byteLength;
      if (bytes > MAXIMUM_RESPONSE_BYTES) return null;
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  try {
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return payload;
  } catch {
    return null;
  }
}

/**
 * Sends one recording to OpenRouter or Z.AI and reads the text (PAGE-273).
 *
 * @remarks
 * The key travels only in the header, redirects are refused, and neither the
 * audio, the key nor a provider's answer is logged; only the provider, the
 * HTTP status and the outcome are. OpenRouter is asked through its
 * speech-to-text endpoint `POST /api/v1/audio/transcriptions` with `model`,
 * `input_audio` and `response_format: "json"` (PAGE-294), Z.AI through its
 * own transcription endpoint. Neither gets an instruction or a language, and
 * a failed transcription is never retried through another API.
 */
export class SpeechProviderClient {
  private readonly request: typeof fetch;

  public constructor(request: typeof fetch = fetch) {
    this.request = request;
  }

  /**
   * Recognizes the text of a recording.
   *
   * @param input - Provider, key, model, audio and the caller's cancellation.
   * @returns The text, or why there is none; it never rejects, except when
   * the caller cancelled.
   */
  public async transcribe(
    input: SpeechProviderRequest,
  ): Promise<SpeechProviderOutcome> {
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ]);
    let response: Response;
    try {
      response = await this.request(
        input.provider === "zai"
          ? ZAI_TRANSCRIPTION_URL
          : OPENROUTER_TRANSCRIPTION_URL,
        {
          ...(input.provider === "zai"
            ? zaiRequest(input)
            : openRouterRequest(input)),
          signal,
          redirect: "error",
        },
      );
    } catch {
      input.signal.throwIfAborted();
      this.log(input.provider, null, "provider_unreachable");
      return UNREACHABLE;
    }
    return this.readAnswer(input, response, signal);
  }

  private async readAnswer(
    input: SpeechProviderRequest,
    response: Response,
    signal: AbortSignal,
  ): Promise<SpeechProviderOutcome> {
    let payload: unknown;
    try {
      payload = await readBody(response);
    } catch {
      input.signal.throwIfAborted();
      this.log(input.provider, response.status, "provider_unreachable");
      return signal.aborted ? UNREACHABLE : FAILED;
    }
    const text = response.ok ? readTranscriptionText(payload) : null;
    this.log(
      input.provider,
      response.status,
      text === null ? "provider_failed" : "ok",
    );
    if (text === null) return FAILED;
    return { ok: true, text: text.replaceAll(input.apiKey, "").trim() };
  }

  private log(
    provider: SpeechProviderId,
    statusCode: number | null,
    outcome: string,
  ): void {
    logEvent({
      level: outcome === "ok" ? "debug" : "warn",
      event: "speech.provider.response",
      component: COMPONENT,
      message: "Speech recognition provider answered",
      metadata: { provider, statusCode, reason: outcome },
    });
  }
}
