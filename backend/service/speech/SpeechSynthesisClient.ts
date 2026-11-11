import { logEvent } from "@/backend/logging/Logger";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import { readPcmLayout, wavFromPcm } from "./SpeechSynthesisAudio";

/** The audio formats Pages hands to a browser. */
export type SynthesizedAudioType = "audio/wav" | "audio/mpeg";

/** One speech output request to OpenRouter. */
export interface SpeechSynthesisRequest {
  readonly apiKey: string;
  readonly model: string;
  readonly text: string;
  /** The voice ID; `null` lets the provider use its documented default. */
  readonly voice: string | null;
  /** The playback speed, 0.5 to 2.0. */
  readonly speed: number;
  readonly signal: AbortSignal;
}

/** What OpenRouter made of a text. */
export type SpeechSynthesisOutcome =
  | {
      readonly ok: true;
      readonly audio: Buffer;
      readonly mimeType: SynthesizedAudioType;
      /**
       * Whether the model took the speed; `false` when it refused the
       * parameter, so the player applies the speed instead.
       */
      readonly isSpeedApplied: boolean;
    }
  | {
      readonly ok: false;
      readonly code: "provider_failed" | "provider_unreachable";
    };

/** One attempt of a request: the format and whether the speed is sent. */
interface SpeechAttempt {
  readonly format: "pcm" | "mp3";
  readonly sendsSpeed: boolean;
}

/** OpenRouter's text-to-speech endpoint (PAGE-300). */
const OPENROUTER_SPEECH_URL = `${AGENT_PROVIDERS.openrouter.endpoint}/audio/speech`;

/** How long OpenRouter may take for one text. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The largest audio Pages reads: about ten minutes of 24 kHz PCM. */
const MAXIMUM_AUDIO_BYTES = 32 * 1024 * 1024;

const COMPONENT = "SpeechSynthesisClient";

const FAILED: SpeechSynthesisOutcome = { ok: false, code: "provider_failed" };
const UNREACHABLE: SpeechSynthesisOutcome = {
  ok: false,
  code: "provider_unreachable",
};

/**
 * The attempts of one request, in order.
 *
 * @remarks
 * OpenRouter answers in raw PCM by default, but some models take only `pcm`
 * (Gemini, HeyGen) and others only `mp3` (MiniMax); a model that does not
 * take `speed` answers a speed other than 1.0 with `400`. Every refusal with
 * `400` costs nothing, so the next attempt drops what was refused.
 */
function attempts(speed: number): readonly SpeechAttempt[] {
  const plain: readonly SpeechAttempt[] = [
    { format: "pcm", sendsSpeed: false },
    { format: "mp3", sendsSpeed: false },
  ];
  if (speed === 1) return plain;
  return [
    { format: "pcm", sendsSpeed: true },
    { format: "mp3", sendsSpeed: true },
    ...plain,
  ];
}

function requestBody(
  request: SpeechSynthesisRequest,
  attempt: SpeechAttempt,
): string {
  return JSON.stringify({
    model: request.model,
    input: request.text,
    ...(request.voice === null ? {} : { voice: request.voice }),
    response_format: attempt.format,
    ...(attempt.sendsSpeed ? { speed: request.speed } : {}),
  });
}

async function readAudio(response: Response): Promise<Buffer | null> {
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
      if (bytes > MAXIMUM_AUDIO_BYTES) return null;
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return bytes === 0 ? null : Buffer.concat(chunks);
}

// The response names its format; raw PCM becomes a WAV file a browser plays.
function playableAudio(
  audio: Buffer,
  contentType: string,
): { readonly audio: Buffer; readonly mimeType: SynthesizedAudioType } | null {
  const type = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (type === "audio/mpeg" || type === "audio/mp3")
    return { audio, mimeType: "audio/mpeg" };
  if (type === "audio/wav" || type === "audio/x-wav")
    return { audio, mimeType: "audio/wav" };
  if (type === "audio/pcm" || type === "audio/l16")
    return {
      audio: wavFromPcm(audio, readPcmLayout(contentType)),
      mimeType: "audio/wav",
    };
  return null;
}

/**
 * Turns a text into speech through OpenRouter (PAGE-300).
 *
 * @remarks
 * `POST https://openrouter.ai/api/v1/audio/speech` with `model`, `input`,
 * `voice`, `response_format` and, for a speed other than 1.0, `speed`
 * (https://openrouter.ai/docs/api/api-reference/tts/create-speech). The
 * answer is the raw audio. The key travels only in the header, redirects are
 * refused, and neither the text, the audio, the key nor an error body is
 * logged; only the HTTP status and the outcome are. The transport is
 * injected, so a test or a development run answers without a key and
 * without cost.
 */
export class SpeechSynthesisClient {
  private readonly request: typeof fetch;

  public constructor(request: typeof fetch = fetch) {
    this.request = request;
  }

  /**
   * Speaks a text with a voice and a speed.
   *
   * @param input - Key, model, text, voice, speed and the caller's cancellation.
   * @returns The audio, or why there is none; it never rejects, except when
   * the caller cancelled.
   */
  public async synthesize(
    input: SpeechSynthesisRequest,
  ): Promise<SpeechSynthesisOutcome> {
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ]);
    for (const attempt of attempts(input.speed)) {
      const response = await this.send(input, attempt, signal);
      if (response === null) return UNREACHABLE;
      this.log(response.status);
      if (response.status === 400) {
        await response.body?.cancel();
        continue;
      }
      return this.readAnswer(input, response, attempt);
    }
    return FAILED;
  }

  private async send(
    input: SpeechSynthesisRequest,
    attempt: SpeechAttempt,
    signal: AbortSignal,
  ): Promise<Response | null> {
    try {
      return await this.request(OPENROUTER_SPEECH_URL, {
        method: "POST",
        headers: {
          Accept: "audio/*",
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: requestBody(input, attempt),
        signal,
        redirect: "error",
      });
    } catch {
      input.signal.throwIfAborted();
      this.log(null);
      return null;
    }
  }

  private async readAnswer(
    input: SpeechSynthesisRequest,
    response: Response,
    attempt: SpeechAttempt,
  ): Promise<SpeechSynthesisOutcome> {
    if (!response.ok) {
      await response.body?.cancel();
      return FAILED;
    }
    let audio: Buffer | null;
    try {
      audio = await readAudio(response);
    } catch {
      input.signal.throwIfAborted();
      return UNREACHABLE;
    }
    const playable =
      audio === null
        ? null
        : playableAudio(audio, response.headers.get("content-type") ?? "");
    if (playable === null) return FAILED;
    return {
      ok: true,
      ...playable,
      isSpeedApplied: input.speed === 1 || attempt.sendsSpeed,
    };
  }

  private log(statusCode: number | null): void {
    const isOk = statusCode !== null && statusCode >= 200 && statusCode < 300;
    logEvent({
      level: isOk ? "debug" : "warn",
      event: "speech.synthesis.response",
      component: COMPONENT,
      message: "Speech output provider answered",
      metadata: { provider: "openrouter", statusCode },
    });
  }
}
