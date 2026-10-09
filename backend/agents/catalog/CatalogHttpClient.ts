import { AgentError } from "@/backend/error/AgentErrors";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import { classifyProviderError } from "../providers/ProviderErrors";
import { requestHeaders } from "../providers/ProviderHttpClient";

import type { ApiProviderId } from "@/definition/AgentConnection";

const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

/** Catalog transport is separate from model tests and can only issue metadata GETs. */
export class CatalogHttpClient {
  private readonly request: typeof fetch;

  public constructor(request: typeof fetch = fetch) {
    this.request = request;
  }

  /** Bounds streamed bytes before JSON parsing; redirects and retries are forbidden. */
  public async get(input: {
    readonly provider: ApiProviderId;
    readonly apiKey: string;
    readonly path: string;
    readonly signal: AbortSignal;
    readonly remainingBytes: number;
  }): Promise<{ readonly payload: unknown; readonly bytes: number }> {
    const { provider, apiKey, path, signal } = input;
    try {
      signal.throwIfAborted();
      const response = await this.request(
        `${AGENT_PROVIDERS[provider].endpoint}${path}`,
        {
          method: "GET",
          headers: requestHeaders(provider, apiKey),
          signal,
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new AgentError(
          classifyProviderError(
            response.status,
            await this.readErrorPayload(response, input.remainingBytes),
          ) ?? "provider_bad_response",
        );
      const result = await this.readBody(
        response,
        Math.min(MAX_PAGE_BYTES, input.remainingBytes),
      );
      signal.throwIfAborted();
      const payload: unknown = JSON.parse(result.text);
      const structuredError = classifyProviderError(response.status, payload);
      if (structuredError) throw new AgentError(structuredError);
      return { payload, bytes: result.bytes };
    } catch (error: unknown) {
      if (signal.aborted) throw new AgentError("check_timeout");
      if (error instanceof AgentError) throw error;
      throw new AgentError(
        error instanceof SyntaxError
          ? "provider_bad_response"
          : "provider_unreachable",
      );
    }
  }

  // Error bodies are parsed only for structured codes such as Gemini's
  // API_KEY_INVALID; without them the HTTP status alone decides.
  private async readErrorPayload(
    response: Response,
    remainingBytes: number,
  ): Promise<unknown> {
    try {
      const result = await this.readBody(
        response,
        Math.min(MAX_ERROR_BYTES, remainingBytes),
      );
      const payload: unknown = JSON.parse(result.text);
      return payload;
    } catch {
      return null;
    }
  }

  private async readBody(
    response: Response,
    maximum: number,
  ): Promise<{ readonly text: string; readonly bytes: number }> {
    if (!response.body) throw new AgentError("provider_bad_response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maximum) throw new AgentError("catalog_limit_exceeded");
        chunks.push(chunk.value);
      }
      return { text: Buffer.concat(chunks).toString("utf8"), bytes };
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
}
