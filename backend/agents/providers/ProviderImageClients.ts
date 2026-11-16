import { z } from "zod";

import { AgentImageError } from "@/backend/error/AgentImageError";
import { logEvent } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";
import {
  AGENT_IMAGE_LIMITS,
  AGENT_IMAGE_MIME_TYPES,
} from "@/definition/AgentImageGeneration";

import type { AgentImageAspectRatio } from "@/definition/AgentImageGeneration";

const COMPONENT = "ProviderImageClients";
const DATA_URL = /^data:(image\/[\w.+-]+);base64,(.+)$/su;
const DETAIL_CHARACTERS = 300;

/** An image going to or coming from a provider. */
export interface ProviderImage {
  readonly mimeType: string;
  readonly bytes: Buffer;
}

/** One request for one image. */
export interface ProviderImageRequest {
  readonly apiKey: string;
  /** The model as the provider names it, without a prefix of OpenCode. */
  readonly model: string;
  readonly prompt: string;
  readonly aspectRatio?: AgentImageAspectRatio;
  readonly templates: readonly ProviderImage[];
  readonly signal: AbortSignal;
}

/** What one request returned. */
export interface ProviderImageAnswer {
  readonly images: readonly ProviderImage[];
  /** What the model wrote beside the images, bounded; empty without text. */
  readonly text: string;
  /** The cost in US dollars as the provider reported it; `null` without one. */
  readonly costUsd: number | null;
}

/** The image interface of one provider. */
export interface ProviderImageClient {
  generate(request: ProviderImageRequest): Promise<ProviderImageAnswer>;
}

function bounded(text: string): string {
  return redactCredentials(text.trim()).slice(0, DETAIL_CHARACTERS);
}

function toBase64(image: ProviderImage): string {
  return image.bytes.toString("base64");
}

function readDataUrl(url: string): ProviderImage | null {
  const match = DATA_URL.exec(url);
  const [, mimeType = "", encoded = ""] = match ?? [];
  if (!match || !Object.hasOwn(AGENT_IMAGE_MIME_TYPES, mimeType)) return null;
  return { mimeType, bytes: Buffer.from(encoded, "base64") };
}

/** Reads a JSON answer up to the limit of {@link AGENT_IMAGE_LIMITS}. */
async function readJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > AGENT_IMAGE_LIMITS.answerBytes) {
    await response.body?.cancel();
    throw new AgentImageError("provider_failed", "Antwort zu groß");
  }
  const text = await response.text();
  if (text.length > AGENT_IMAGE_LIMITS.answerBytes)
    throw new AgentImageError("provider_failed", "Antwort zu groß");
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentImageError("provider_failed", "Antwort ist kein JSON");
  }
}

/** The message of an error answer, as OpenRouter and Google send it. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(body);
    if (message.success) return bounded(message.data.error.message);
  } catch {
    // An error without a readable body keeps its status alone.
  }
  return `HTTP ${String(response.status)}`;
}

async function send(
  provider: string,
  request: { readonly url: string; readonly init: RequestInit },
  transport: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await transport(request.url, {
      ...request.init,
      redirect: "error",
    });
  } catch (error: unknown) {
    if (request.init.signal?.aborted && !(error instanceof AgentImageError))
      throw new AgentImageError("provider_unreachable", "Zeit abgelaufen");
    throw new AgentImageError("provider_unreachable");
  }
  logEvent({
    level: response.ok ? "info" : "warn",
    event: "agent.image.request",
    component: COMPONENT,
    message: "An agent asked a provider for an image.",
    metadata: { provider, status: response.status },
  });
  if (!response.ok)
    throw new AgentImageError("provider_failed", await errorDetail(response));
  return readJson(response);
}

const OPENROUTER_ANSWER = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          images: z
            .array(z.object({ image_url: z.object({ url: z.string() }) }))
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ cost: z.number().optional() }).optional(),
});

/**
 * The image output of OpenRouter models.
 *
 * @remarks
 * `POST https://openrouter.ai/api/v1/chat/completions` with
 * `modalities: ["image", "text"]`, the templates as `image_url` parts and
 * `image_config.aspect_ratio`; the images come back as data URLs in
 * `choices[0].message.images` and the cost in `usage.cost`
 * (https://openrouter.ai/docs/features/multimodal/image-generation). The key
 * travels only in the header; redirects are refused and no prompt, key or
 * image is logged.
 */
export class OpenRouterImageClient implements ProviderImageClient {
  private readonly transport: typeof fetch;

  public constructor(transport: typeof fetch = fetch) {
    this.transport = transport;
  }

  /**
   * Asks for one image.
   * @throws {AgentImageError} For a refused or unreadable request.
   */
  public async generate(
    request: ProviderImageRequest,
  ): Promise<ProviderImageAnswer> {
    const content = [
      { type: "text", text: request.prompt },
      ...request.templates.map((image) => ({
        type: "image_url",
        image_url: { url: `data:${image.mimeType};base64,${toBase64(image)}` },
      })),
    ];
    const body = await send(
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
            messages: [{ role: "user", content }],
            modalities: ["image", "text"],
            usage: { include: true },
            ...(request.aspectRatio
              ? { image_config: { aspect_ratio: request.aspectRatio } }
              : {}),
          }),
        },
      },
      this.transport,
    );
    const answer = OPENROUTER_ANSWER.safeParse(body);
    if (!answer.success)
      throw new AgentImageError("provider_failed", "Antwort unlesbar");
    const message = answer.data.choices[0]?.message;
    return {
      images: (message?.images ?? [])
        .map((image) => readDataUrl(image.image_url.url))
        .filter((image) => image !== null),
      text: bounded(message?.content ?? ""),
      costUsd: answer.data.usage?.cost ?? null,
    };
  }
}

const GOOGLE_ANSWER = z.object({
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

/**
 * The image output of Gemini models of Google AI Studio.
 *
 * @remarks
 * `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
 * with `generationConfig.responseModalities: ["TEXT", "IMAGE"]`, the
 * templates as `inline_data` parts and `imageConfig.aspectRatio`; the images
 * come back as `inlineData` parts
 * (https://ai.google.dev/gemini-api/docs/image-generation). Google reports no
 * price, so the cost stays unknown. The key travels only in the header.
 */
export class GoogleImageClient implements ProviderImageClient {
  private readonly transport: typeof fetch;

  public constructor(transport: typeof fetch = fetch) {
    this.transport = transport;
  }

  /**
   * Asks for one image.
   * @throws {AgentImageError} For a refused or unreadable request.
   */
  public async generate(
    request: ProviderImageRequest,
  ): Promise<ProviderImageAnswer> {
    const parts = [
      { text: request.prompt },
      ...request.templates.map((image) => ({
        inline_data: { mime_type: image.mimeType, data: toBase64(image) },
      })),
    ];
    const body = await send(
      "google_ai_studio",
      {
        url: `${AGENT_PROVIDERS.google_ai_studio.endpoint}/models/${encodeURIComponent(request.model)}:generateContent`,
        init: {
          method: "POST",
          signal: request.signal,
          headers: {
            "x-goog-api-key": request.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              ...(request.aspectRatio
                ? { imageConfig: { aspectRatio: request.aspectRatio } }
                : {}),
            },
          }),
        },
      },
      this.transport,
    );
    const answer = GOOGLE_ANSWER.safeParse(body);
    if (!answer.success)
      throw new AgentImageError("provider_failed", "Antwort unlesbar");
    const answered = answer.data.candidates?.[0]?.content?.parts ?? [];
    const images: ProviderImage[] = [];
    for (const part of answered) {
      const inlineImage = part.inlineData;
      if (
        inlineImage &&
        Object.hasOwn(AGENT_IMAGE_MIME_TYPES, inlineImage.mimeType)
      )
        images.push({
          mimeType: inlineImage.mimeType,
          bytes: Buffer.from(inlineImage.data, "base64"),
        });
    }
    return {
      images,
      text: bounded(
        answered
          .map((part) => part.text ?? "")
          .join(" ")
          .trim(),
      ),
      costUsd: null,
    };
  }
}
