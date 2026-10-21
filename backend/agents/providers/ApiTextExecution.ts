import { readTicketAssetInput } from "@/backend/agents/TicketAssetInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentProviderError } from "@/backend/error/AgentProviderError";
import { isPlanRetryCode } from "@/backend/agents/AgentProviderFailure";
import { AGENT_PROVIDERS, isApiProvider } from "@/definition/AgentConnection";
import { logCaughtError } from "@/backend/logging/Logger";

import { classifyProviderError } from "./ProviderErrors";
import { requestHeaders } from "./ProviderHttpClient";
import { httpProviderReset } from "./ProviderReset";
import {
  createTextProviderRequest,
  readTextProviderResponse,
} from "./TextProviderPayload";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  TextExecution,
  TextExecutionInput,
} from "@/backend/agents/TextExecution";

/** Reuses A7 credentials and fixed hosts for a single bounded, non-retrying request. */
export class ApiTextExecution implements TextExecution {
  private readonly repository: Pick<
    AgentConnectionRepository,
    "find" | "findSecretEncrypted"
  >;
  private readonly cipher: InstanceSecretCipher;
  private readonly request: typeof fetch;

  public constructor(
    repository: Pick<AgentConnectionRepository, "find" | "findSecretEncrypted">,
    cipher: InstanceSecretCipher,
    request: typeof fetch = fetch,
  ) {
    this.repository = repository;
    this.cipher = cipher;
    this.request = request;
  }

  /** No credential, diagnostic body or incomplete output can leave this boundary. */
  public async run(
    input: TextExecutionInput,
    signal: AbortSignal,
  ): Promise<string> {
    const { connection } = input.agent;
    if (!isApiProvider(connection.provider))
      throw new AgentExecutionError("connectionUnavailable");
    const current = await this.repository.find(connection.id);
    if (!current || current.provider !== connection.provider)
      throw new AgentExecutionError("connectionUnavailable");
    const apiKey = await this.readApiKey(connection.id);
    try {
      const assets = await readTicketAssetInput(input);
      const request = createTextProviderRequest(
        connection.provider,
        input,
        assets,
      );
      signal.throwIfAborted();
      const response = await this.request(
        `${AGENT_PROVIDERS[connection.provider].endpoint}${request.path}`,
        {
          method: "POST",
          headers: requestHeaders(connection.provider, apiKey),
          body: JSON.stringify(request.body),
          signal,
          redirect: "error",
        },
      );
      const payload = await this.readBody(response).catch((error: unknown) => {
        if (response.status >= 400) return null;
        throw error;
      });
      signal.throwIfAborted();
      const code = classifyProviderError(response.status, payload);
      if (isPlanRetryCode(code))
        throw new AgentProviderError({
          code,
          resetAt: httpProviderReset(response, payload, code),
        });
      if (code) throw new AgentError(code);
      return readTextProviderResponse(connection.provider, payload, {
        webSearch: input.webSearch,
      }).replaceAll(apiKey, "[redacted]");
    } catch (error: unknown) {
      logCaughtError("ApiTextExecution", error);

      if (error instanceof AgentExecutionError || error instanceof AgentError)
        throw error;
      if (signal.aborted) signal.throwIfAborted();
      throw new AgentProviderError({
        code: "provider_unreachable",
        resetAt: null,
      });
    }
  }

  /**
   * A key that is missing or no longer decrypts, for example after the
   * instance key changed, makes the access unusable; it is no provider failure.
   */
  private async readApiKey(connectionId: string): Promise<string> {
    const encrypted = await this.repository.findSecretEncrypted(connectionId);
    if (encrypted === null)
      throw new AgentExecutionError("connectionUnavailable");
    try {
      return this.cipher.decrypt(connectionId, encrypted);
    } catch (caughtError: unknown) {
      logCaughtError("ApiTextExecution", caughtError);

      throw new AgentExecutionError("connectionUnavailable");
    }
  }

  private async readBody(response: Response): Promise<unknown> {
    if (!response.body) throw new AgentExecutionError("invalidOutput");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024 * 1024) throw new AgentExecutionError("invalidOutput");
        chunks.push(chunk.value);
      }
      try {
        const payload: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        return payload;
      } catch {
        throw new AgentExecutionError("invalidOutput");
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
}
