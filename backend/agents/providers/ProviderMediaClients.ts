import { z } from "zod";

import { AgentMediaError } from "@/backend/error/AgentMediaError";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";
import {
  AGENT_AUDIO_MIME_TYPES,
  AGENT_MEDIA_LIMITS,
  AGENT_VIDEO_MIME_TYPES,
} from "@/definition/AgentMediaGeneration";

import {
  DEFAULT_PCM_RATE,
  boundedDetail,
  isRawPcm,
  isRedirect,
  pcmRateOf,
  pcmToWav,
  readMediaBytes,
  readMediaJson,
  sendMediaRequest,
  waitForProvider,
} from "./ProviderMediaTransport";

import type {
  AgentMediaKind,
  AgentVideoAspectRatio,
} from "@/definition/AgentMediaGeneration";
import type { ProviderMedia } from "./ProviderMediaTransport";

export type { ProviderMedia } from "./ProviderMediaTransport";

/** One request for one video or one sound. */
export interface ProviderMediaRequest {
  readonly apiKey: string;
  /** The model as the provider names it, without a prefix of OpenCode. */
  readonly model: string;
  readonly kind: AgentMediaKind;
  readonly prompt: string;
  /** For a video: the aspect ratio. */
  readonly aspectRatio?: AgentVideoAspectRatio;
  /** For a video: the length in seconds. */
  readonly durationSeconds?: number;
  /** For a sound: the voice as the provider names it. */
  readonly voice?: string;
  readonly signal: AbortSignal;
}

/** What one request returned. */
export interface ProviderMediaAnswer {
  readonly media: readonly ProviderMedia[];
  /** What the model wrote beside the file, bounded; empty without text. */
  readonly text: string;
  /** The cost in US dollars as the provider reported it; `null` without one. */
  readonly costUsd: number | null;
}

/** The video or audio interface of one provider. */
export interface ProviderMediaClient {
  /** The kinds the documented interface of the provider generates. */
  readonly kinds: readonly AgentMediaKind[];
  generate(request: ProviderMediaRequest): Promise<ProviderMediaAnswer>;
}

/** The voice of OpenAI audio models over OpenRouter when the agent names none. */
const OPENROUTER_DEFAULT_VOICE = "alloy";

/** The voice of Gemini speech when the agent names none. */
const GOOGLE_DEFAULT_VOICE = "Kore";

const OPENROUTER_CHUNK = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullable().optional(),
            audio: z
              .object({
                data: z.string().optional(),
                transcript: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usage: z.object({ cost: z.number().optional() }).optional(),
});

/** The audio, the text and the cost collected from the stream of OpenRouter. */
interface OpenRouterStream {
  readonly audio: string[];
  readonly text: string[];
  costUsd: number | null;
}

function readOpenRouterLine(line: string, collected: OpenRouterStream): void {
  if (!line.startsWith("data:")) return;
  const data = line.slice(5).trim();
  if (data === "" || data === "[DONE]") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  const chunk = OPENROUTER_CHUNK.safeParse(parsed);
  if (!chunk.success) return;
  const delta = chunk.data.choices?.[0]?.delta;
  if (delta?.audio?.data) collected.audio.push(delta.audio.data);
  const text = delta?.audio?.transcript ?? delta?.content ?? "";
  if (text !== "") collected.text.push(text);
  const cost = chunk.data.usage?.cost;
  if (cost !== undefined) collected.costUsd = cost;
}

/**
 * The audio output of OpenRouter models.
 *
 * @remarks
 * `POST https://openrouter.ai/api/v1/chat/completions` with
 * `modalities: ["text", "audio"]`, `audio: { voice, format: "pcm16" }` and
 * `stream: true`, as OpenRouter documents audio output; the sound streams as
 * base64 PCM in `choices[0].delta.audio.data`, the spoken text in
 * `delta.audio.transcript` and the cost in `usage.cost` of the last chunk
 * (https://openrouter.ai/docs/features/multimodal/audio). Pages puts the
 * 24 kHz PCM into a WAV file. OpenRouter documents no video output over this
 * interface, so it offers audio alone. The key travels only in the header;
 * redirects are refused.
 */
export class OpenRouterMediaClient implements ProviderMediaClient {
  public readonly kinds: readonly AgentMediaKind[] = ["audio"];
  private readonly transport: typeof fetch;

  public constructor(transport: typeof fetch = fetch) {
    this.transport = transport;
  }

  /**
   * Asks for one sound.
   *
   * @throws {AgentMediaError} For a video, or a refused or unreadable request.
   */
  public async generate(
    request: ProviderMediaRequest,
  ): Promise<ProviderMediaAnswer> {
    if (request.kind !== "audio") throw new AgentMediaError("no_media_interface");
    const response = await sendMediaRequest(
      "openrouter",
      {
        url: `${AGENT_PROVIDERS.openrouter.endpoint}/chat/completions`,
        init: {
          method: "POST",
          signal: request.signal,
          headers: {
            Authorization: `Bearer ${request.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: request.model,
            messages: [{ role: "user", content: request.prompt }],
            modalities: ["text", "audio"],
            audio: {
              voice: request.voice ?? OPENROUTER_DEFAULT_VOICE,
              format: "pcm16",
            },
            stream: true,
            usage: { include: true },
          }),
        },
      },
      this.transport,
    );
    const collected: OpenRouterStream = { audio: [], text: [], costUsd: null };
    for (const line of (await response.text()).split("\n"))
      readOpenRouterLine(line.trim(), collected);
    // Every chunk is base64 of its own, padding included.
    const pcm = Buffer.concat(
      collected.audio.map((chunk) => Buffer.from(chunk, "base64")),
    );
    return {
      media:
        pcm.length === 0
          ? []
          : [{ mimeType: "audio/wav", bytes: pcmToWav(pcm, DEFAULT_PCM_RATE) }],
      text: boundedDetail(collected.text.join("")),
      costUsd: collected.costUsd,
    };
  }
}

const GOOGLE_AUDIO_ANSWER = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  inlineData: z
                    .object({ mimeType: z.string(), data: z.string() })
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const GOOGLE_OPERATION = z.object({
  name: z.string().optional(),
  done: z.boolean().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  response: z
    .object({
      generateVideoResponse: z
        .object({
          generatedSamples: z
            .array(
              z.object({
                video: z.object({ uri: z.string().optional() }).optional(),
              }),
            )
            .optional(),
          raiMediaFilteredReasons: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});

type GoogleOperation = z.infer<typeof GOOGLE_OPERATION>;

/** A sound part of Gemini as a file every browser plays. */
function googleAudioOf(part: {
  readonly mimeType: string;
  readonly data: string;
}): ProviderMedia | null {
  const bytes = Buffer.from(part.data, "base64");
  if (isRawPcm(part.mimeType))
    return { mimeType: "audio/wav", bytes: pcmToWav(bytes, pcmRateOf(part.mimeType)) };
  const type = part.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const mimeType = type === "audio/x-wav" ? "audio/wav" : type;
  return Object.hasOwn(AGENT_AUDIO_MIME_TYPES, mimeType)
    ? { mimeType, bytes }
    : null;
}

/** Whether a download address belongs to the Gemini API, the only place the key may go. */
function isGoogleAddress(uri: string): boolean {
  try {
    return (
      new URL(uri).origin ===
      new URL(AGENT_PROVIDERS.google_ai_studio.endpoint).origin
    );
  } catch {
    return false;
  }
}

/**
 * The video and audio output of Gemini models of Google AI Studio.
 *
 * @remarks
 * - Audio: `POST …/models/<model>:generateContent` with
 *   `generationConfig.responseModalities: ["AUDIO"]` and a prebuilt voice;
 *   the sound comes back as `inlineData`, raw 16-bit PCM
 *   (`audio/L16;codec=pcm;rate=24000`), which Pages puts into a WAV file
 *   (https://ai.google.dev/gemini-api/docs/speech-generation).
 * - Video: `POST …/models/<model>:predictLongRunning` with the prompt and
 *   `aspectRatio` and `durationSeconds`, then `GET …/<operation>` until it
 *   is done, and the file from `generatedSamples[0].video.uri`
 *   (https://ai.google.dev/gemini-api/docs/video). The key goes only to the
 *   Gemini API; the download follows its redirect to the storage without it.
 *
 * Google reports no price, so the cost stays unknown.
 */
export class GoogleMediaClient implements ProviderMediaClient {
  public readonly kinds: readonly AgentMediaKind[] = ["video", "audio"];
  private readonly transport: typeof fetch;
  private readonly pollMilliseconds: number;

  public constructor(
    transport: typeof fetch = fetch,
    pollMilliseconds: number = AGENT_MEDIA_LIMITS.pollMilliseconds,
  ) {
    this.transport = transport;
    this.pollMilliseconds = pollMilliseconds;
  }

  /**
   * Asks for one video or one sound.
   *
   * @throws {AgentMediaError} For a refused or unreadable request.
   */
  public async generate(
    request: ProviderMediaRequest,
  ): Promise<ProviderMediaAnswer> {
    return request.kind === "audio"
      ? this.generateAudio(request)
      : this.generateVideo(request);
  }

  private headers(apiKey: string): Record<string, string> {
    return { "x-goog-api-key": apiKey, "Content-Type": "application/json" };
  }

  private async generateAudio(
    request: ProviderMediaRequest,
  ): Promise<ProviderMediaAnswer> {
    const response = await sendMediaRequest(
      "google_ai_studio",
      {
        url: `${AGENT_PROVIDERS.google_ai_studio.endpoint}/models/${encodeURIComponent(request.model)}:generateContent`,
        init: {
          method: "POST",
          signal: request.signal,
          headers: this.headers(request.apiKey),
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: request.prompt }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: request.voice ?? GOOGLE_DEFAULT_VOICE,
                  },
                },
              },
            },
          }),
        },
      },
      this.transport,
    );
    const answer = GOOGLE_AUDIO_ANSWER.safeParse(await readMediaJson(response));
    if (!answer.success)
      throw new AgentMediaError("provider_failed", "Antwort unlesbar");
    const parts = answer.data.candidates?.[0]?.content?.parts ?? [];
    return {
      media: parts
        .map((part) => (part.inlineData ? googleAudioOf(part.inlineData) : null))
        .filter((media) => media !== null),
      text: boundedDetail(parts.map((part) => part.text ?? "").join(" ")),
      costUsd: null,
    };
  }

  private async generateVideo(
    request: ProviderMediaRequest,
  ): Promise<ProviderMediaAnswer> {
    const started = await sendMediaRequest(
      "google_ai_studio",
      {
        url: `${AGENT_PROVIDERS.google_ai_studio.endpoint}/models/${encodeURIComponent(request.model)}:predictLongRunning`,
        init: {
          method: "POST",
          signal: request.signal,
          headers: this.headers(request.apiKey),
          body: JSON.stringify({
            instances: [{ prompt: request.prompt }],
            parameters: {
              ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
              ...(request.durationSeconds
                ? { durationSeconds: request.durationSeconds }
                : {}),
            },
          }),
        },
      },
      this.transport,
    );
    const operation = await this.finish(await readMediaJson(started), request);
    const result = operation.response?.generateVideoResponse;
    const uri = result?.generatedSamples?.[0]?.video?.uri;
    if (uri === undefined)
      return {
        media: [],
        text: boundedDetail((result?.raiMediaFilteredReasons ?? []).join(" ")),
        costUsd: null,
      };
    return {
      media: [await this.download(uri, request)],
      text: "",
      costUsd: null,
    };
  }

  /** Looks at the operation until it is done; the signal of the request ends the wait. */
  private async finish(
    body: unknown,
    request: ProviderMediaRequest,
  ): Promise<GoogleOperation> {
    const parsed = GOOGLE_OPERATION.safeParse(body);
    if (!parsed.success || parsed.data.name === undefined)
      throw new AgentMediaError("provider_failed", "Antwort unlesbar");
    let operation = parsed.data;
    const name = parsed.data.name;
    while (operation.done !== true) {
      await waitForProvider(this.pollMilliseconds, request.signal);
      const response = await sendMediaRequest(
        "google_ai_studio",
        {
          url: `${AGENT_PROVIDERS.google_ai_studio.endpoint}/${name}`,
          init: {
            method: "GET",
            signal: request.signal,
            headers: this.headers(request.apiKey),
          },
        },
        this.transport,
      );
      const next = GOOGLE_OPERATION.safeParse(await readMediaJson(response));
      if (!next.success)
        throw new AgentMediaError("provider_failed", "Antwort unlesbar");
      operation = next.data;
    }
    if (operation.error)
      throw new AgentMediaError(
        "provider_failed",
        boundedDetail(operation.error.message ?? ""),
      );
    return operation;
  }

  /** Loads the generated video; the key goes only to the Gemini API, never to the storage. */
  private async download(
    uri: string,
    request: ProviderMediaRequest,
  ): Promise<ProviderMedia> {
    if (!isGoogleAddress(uri))
      throw new AgentMediaError("provider_failed", "Unbekannte Download-Adresse");
    const first = await sendMediaRequest(
      "google_ai_studio",
      {
        url: uri,
        init: {
          method: "GET",
          signal: request.signal,
          headers: { "x-goog-api-key": request.apiKey },
          redirect: "manual",
        },
      },
      this.transport,
    );
    const location = first.headers.get("location");
    const file =
      isRedirect(first) && location !== null
        ? await sendMediaRequest(
            "google_storage",
            {
              url: new URL(location, uri).toString(),
              init: { method: "GET", signal: request.signal, redirect: "follow" },
            },
            this.transport,
          )
        : first;
    const type =
      file.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    return {
      mimeType: Object.hasOwn(AGENT_VIDEO_MIME_TYPES, type) ? type : "video/mp4",
      bytes: await readMediaBytes(file),
    };
  }
}
