import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { AGENT_PROVIDERS, isApiProvider } from "@/definition/AgentConnection";

import { classifyProviderError } from "./ProviderErrors";
import { requestHeaders } from "./ProviderHttpClient";
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
  private readonly repository: AgentConnectionRepository;
  private readonly cipher: InstanceSecretCipher;
  private readonly request: typeof fetch;

  public constructor(
    repository: AgentConnectionRepository,
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
      throw new TextAssistantError("connectionUnavailable");
    const current = await this.repository.find(connection.id);
    if (!current || current.provider !== connection.provider)
      throw new TextAssistantError("connectionUnavailable");
    const encrypted = await this.repository.findSecretEncrypted(connection.id);
    if (encrypted === null)
      throw new TextAssistantError("connectionUnavailable");
    try {
      const apiKey = this.cipher.decrypt(connection.id, encrypted);
      const request = createTextProviderRequest(connection.provider, input);
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
      const payload = await this.readBody(response);
      signal.throwIfAborted();
      if (classifyProviderError(response.status, payload))
        throw new TextAssistantError("providerFailed");
      return readTextProviderResponse(connection.provider, payload).replaceAll(
        apiKey,
        "[redacted]",
      );
    } catch (error: unknown) {
      if (error instanceof TextAssistantError) throw error;
      throw new TextAssistantError("providerFailed");
    }
  }

  private async readBody(response: Response): Promise<unknown> {
    if (!response.body) throw new TextAssistantError("invalidOutput");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024 * 1024) throw new TextAssistantError("invalidOutput");
        chunks.push(chunk.value);
      }
      const payload: unknown = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      );
      return payload;
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
}
