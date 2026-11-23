import { logEvent } from "@/backend/logging/Logger";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import { readPcmLayout, wavFromPcm } from "./SpeechSynthesisAudio";

import type { PcmLayout } from "./SpeechSynthesisAudio";

/** The audio formats Pages hands to a browser. */
export type SynthesizedAudioType = "audio/wav" | "audio/mpeg";

/** How the audio of a streamed request arrives. */
export type SpeechStreamFormat =
  | {
      /** Raw 16-bit little-endian samples, handed on in blocks while they arrive. */
      readonly mimeType: "audio/pcm";
      readonly layout: PcmLayout;
      readonly isSpeedApplied: boolean;
    }
  | {
      /** A whole file, handed on in one block when it is complete. */
      readonly mimeType: SynthesizedAudioType;
      readonly layout: null;
      readonly isSpeedApplied: boolean;
    };

/** Receives the audio of a streamed request. */
export interface SpeechAudioSink {
  /** The provider accepted the request; called once before the first block. */
  readonly begin: (format: SpeechStreamFormat) => void;
  /** The next block; raw PCM blocks always end on a whole sample frame. */
  readonly block: (audio: Buffer) => void;
}

/** What a streamed request gave; the audio itself went to the sink. */
export type SpeechStreamOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "provider_failed" | "provider_unreachable";
    };

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

/** OpenRouter's text-to-speech endpoint. */
const OPENROUTER_SPEECH_URL = `${AGENT_PROVIDERS.openrouter.endpoint}/audio/speech`;

/** How long OpenRouter may take for one text. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The largest audio Pages reads: about ten minutes of 24 kHz PCM. */
const MAXIMUM_AUDIO_BYTES = 32 * 1024 * 1024;

/** The largest block a stream hands on, so a large provider chunk does not hold the first sound back. */
const MAXIMUM_BLOCK_BYTES = 9_600;

const COMPONENT = "SpeechSynthesisClient";

type SpeechFailure = Extract<SpeechSynthesisOutcome, { ok: false }>;

const FAILED: SpeechFailure = { ok: false, code: "provider_failed" };
const UNREACHABLE: SpeechFailure = {
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

function pcmLayoutOf(contentType: string): PcmLayout | null {
  const type = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return type === "audio/pcm" || type === "audio/l16"
    ? readPcmLayout(contentType)
    : null;
}

/** Cuts the arriving PCM into blocks of whole sample frames; a partial frame waits for the next chunk. */
class PcmBlocks {
  private readonly frameBytes: number;
  private readonly sink: SpeechAudioSink;
  private carry: Buffer = Buffer.alloc(0);

  public constructor(layout: PcmLayout, sink: SpeechAudioSink) {
    this.frameBytes = layout.channels * 2;
    this.sink = sink;
  }

  /**
   * Takes the next chunk of the response and hands its whole frames on.
   * @param chunk - The bytes as the provider sent them.
   */
  public push(chunk: Uint8Array): void {
    const joined = Buffer.concat([this.carry, chunk]);
    const usable = joined.length - (joined.length % this.frameBytes);
    this.carry = joined.subarray(usable);
    const step = MAXIMUM_BLOCK_BYTES - (MAXIMUM_BLOCK_BYTES % this.frameBytes);
    for (let start = 0; start < usable; start += step)
      this.sink.block(joined.subarray(start, Math.min(usable, start + step)));
  }
}

async function streamPcm(
  response: Response,
  blocks: PcmBlocks,
): Promise<boolean> {
  if (!response.body) return false;
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (
      let chunk = await reader.read();
      !chunk.done;
      chunk = await reader.read()
    ) {
      bytes += chunk.value.byteLength;
      if (bytes > MAXIMUM_AUDIO_BYTES) return bytes > 0;
      blocks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return bytes > 0;
}

/**
 * Turns a text into speech through OpenRouter.
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
   * @param input - Key, model, text, voice, speed and the caller's cancellation.
   * @returns The audio, or why there is none; it never rejects, except when
   * the caller cancelled.
   */
  public async synthesize(
    input: SpeechSynthesisRequest,
  ): Promise<SpeechSynthesisOutcome> {
    const answer = await this.accepted(input);
    if (!("response" in answer)) return answer;
    return this.readAnswer(input, answer.response, answer.attempt);
  }

  /**
   * Speaks a text and hands the audio on while it arrives.
   * @param input - Key, model, text, voice, speed and the caller's cancellation.
   * @param sink - Receives the format, then the audio in blocks: raw PCM as
   * it arrives, any other format as one whole file.
   * @returns Whether audio arrived; it never rejects, except when the caller
   * cancelled.
   * @remarks
   * PCM is asked first, as for {@link synthesize}; a model that refuses it
   * answers MP3, which is handed on whole, so that phrase is buffered.
   */
  public async synthesizeStream(
    input: SpeechSynthesisRequest,
    sink: SpeechAudioSink,
  ): Promise<SpeechStreamOutcome> {
    const answer = await this.accepted(input);
    if (!("response" in answer)) return answer;
    const { response, attempt } = answer;
    const isSpeedApplied = input.speed === 1 || attempt.sendsSpeed;
    const layout = pcmLayoutOf(response.headers.get("content-type") ?? "");
    if (layout === null) {
      const whole = await this.readAnswer(input, response, attempt);
      if (!whole.ok) return whole;
      sink.begin({ mimeType: whole.mimeType, layout: null, isSpeedApplied });
      sink.block(whole.audio);
      return { ok: true };
    }
    sink.begin({ mimeType: "audio/pcm", layout, isSpeedApplied });
    try {
      return (await streamPcm(response, new PcmBlocks(layout, sink)))
        ? { ok: true }
        : FAILED;
    } catch {
      input.signal.throwIfAborted();
      return UNREACHABLE;
    }
  }

  // Every refusal with 400 costs nothing, so the next attempt drops what was refused.
  private async accepted(
    input: SpeechSynthesisRequest,
  ): Promise<
    | { readonly response: Response; readonly attempt: SpeechAttempt }
    | SpeechFailure
  > {
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
      if (!response.ok) {
        await response.body?.cancel();
        return FAILED;
      }
      return { response, attempt };
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
