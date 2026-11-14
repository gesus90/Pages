import { z } from "zod";

import { AgentMediaError } from "@/backend/error/AgentMediaError";
import { logEvent } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { AGENT_MEDIA_LIMITS } from "@/definition/AgentMediaGeneration";

const COMPONENT = "ProviderMediaClients";
const DETAIL_CHARACTERS = 300;
const PCM_RATE = /rate=(\d+)/u;

/** Sample rate of raw PCM when the provider names none: 24 kHz, as OpenAI and Gemini send it. */
export const DEFAULT_PCM_RATE = 24_000;

/** A video or a sound coming from a provider. */
export interface ProviderMedia {
  readonly mimeType: string;
  readonly bytes: Buffer;
}

/**
 * Bounds and redacts a text of a provider before the agent sees it.
 *
 * @param text - What the provider or the model wrote.
 */
export function boundedDetail(text: string): string {
  return redactCredentials(text.trim()).slice(0, DETAIL_CHARACTERS);
}

/** The message of an error answer, as OpenRouter and Google send it. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(body);
    if (message.success) return boundedDetail(message.data.error.message);
  } catch {
    // An error without a readable body keeps its status alone.
  }
  return `HTTP ${String(response.status)}`;
}

/** Refuses an answer whose stated length is beyond the limit, before it is read. */
function checkLength(response: Response): void {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > AGENT_MEDIA_LIMITS.answerBytes)
    throw new AgentMediaError("provider_failed", "Antwort zu groß");
}

/**
 * Sends one request to a provider and returns its successful answer.
 *
 * @remarks
 * Redirects are refused unless `redirect` says otherwise; no prompt, key or
 * file is logged.
 *
 * @throws {AgentMediaError} `provider_unreachable` without an answer or after
 * the time ran out, `provider_failed` for an error status.
 */
export async function sendMediaRequest(
  provider: string,
  request: {
    readonly url: string;
    readonly init: RequestInit;
  },
  transport: typeof fetch,
): Promise<Response> {
  let response: Response;
  try {
    response = await transport(request.url, {
      redirect: "error",
      ...request.init,
    });
  } catch {
    if (request.init.signal?.aborted)
      throw new AgentMediaError("provider_unreachable", "Zeit abgelaufen");
    throw new AgentMediaError("provider_unreachable");
  }
  logEvent({
    level: response.ok || isRedirect(response) ? "info" : "warn",
    event: "agent.media.request",
    component: COMPONENT,
    message: "An agent asked a provider for a video or a sound.",
    metadata: { provider, status: response.status },
  });
  if (!response.ok && !isRedirect(response))
    throw new AgentMediaError("provider_failed", await errorDetail(response));
  checkLength(response);
  return response;
}

/** Whether an answer sends the client elsewhere. */
export function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

/**
 * Reads a JSON answer up to the limit of {@link AGENT_MEDIA_LIMITS}.
 *
 * @throws {AgentMediaError} `provider_failed` for a too large or unreadable answer.
 */
export async function readMediaJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > AGENT_MEDIA_LIMITS.answerBytes)
    throw new AgentMediaError("provider_failed", "Antwort zu groß");
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentMediaError("provider_failed", "Antwort ist kein JSON");
  }
}

/**
 * Reads the bytes of a file answer up to the limit of {@link AGENT_MEDIA_LIMITS}.
 *
 * @throws {AgentMediaError} `provider_failed` for a too large answer.
 */
export async function readMediaBytes(response: Response): Promise<Buffer> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > AGENT_MEDIA_LIMITS.answerBytes)
    throw new AgentMediaError("provider_failed", "Antwort zu groß");
  return bytes;
}

/**
 * The sample rate a raw PCM type names, such as `audio/L16;codec=pcm;rate=24000`.
 *
 * @param mimeType - The type as the provider sent it.
 * @returns The rate, or {@link DEFAULT_PCM_RATE} when it names none.
 */
export function pcmRateOf(mimeType: string): number {
  const rate = Number(PCM_RATE.exec(mimeType)?.[1]);
  return Number.isInteger(rate) && rate > 0 ? rate : DEFAULT_PCM_RATE;
}

/**
 * Whether a type is raw 16-bit PCM without a container, as Gemini and the
 * `pcm16` format of OpenAI models deliver speech.
 *
 * @param mimeType - The type as the provider sent it.
 */
export function isRawPcm(mimeType: string): boolean {
  const type = mimeType.toLowerCase();
  return type.startsWith("audio/l16") || type.startsWith("audio/pcm");
}

/**
 * Puts raw 16-bit mono PCM into a WAV container, so every browser plays it.
 *
 * @param pcm - Little-endian 16-bit samples of one channel.
 * @param sampleRate - Samples per second.
 * @returns The WAV file.
 */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  // PCM, one channel, 16 bits per sample.
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Waits before the next look at a running generation, or ends early when
 * the request is cancelled.
 *
 * @throws {AgentMediaError} `provider_unreachable` once the signal aborts.
 */
export function waitForProvider(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AgentMediaError("provider_unreachable", "Zeit abgelaufen"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    function handleAbort(): void {
      clearTimeout(timer);
      reject(new AgentMediaError("provider_unreachable", "Zeit abgelaufen"));
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}
