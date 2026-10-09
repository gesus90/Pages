import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { readModelList } from "./ProviderResponses";

import type { AgentCheckDetail } from "@/definition/AgentConnection";
import type { ProviderHttpClient } from "./ProviderHttpClient";
import type {
  ApiProviderAdapter,
  ModelTestRequest,
  ProviderCheckOutcome,
} from "./ProviderContracts";

function readMessage(payload: unknown, model: string): AgentCheckDetail | null {
  const result = readAgentObject(payload);
  if (result.type !== "message" || !Array.isArray(result.content)) return null;
  const usage = readAgentObject(result.usage);
  return sanitizeCheckDetail({
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  });
}

/** Uses Anthropic's native versioned API without an SDK or automatic retries. */
export class AnthropicProvider implements ApiProviderAdapter {
  public readonly provider = "anthropic";
  private readonly client: ProviderHttpClient;

  public constructor(client: ProviderHttpClient) {
    this.client = client;
  }

  /** Checks key acceptance using model metadata. */
  public checkAccess(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.client.check(
      {
        provider: this.provider,
        apiKey,
        path: "/models",
        parse: readModelList,
      },
      signal,
    );
  }

  /** Sends a short user message without Pages content or a system prompt. */
  public runModelTest(
    request: ModelTestRequest,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.client.check(
      {
        provider: this.provider,
        apiKey: request.apiKey,
        path: "/messages",
        body: {
          model: request.model,
          max_tokens: 16,
          messages: [{ role: "user", content: MODEL_TEST_PROMPT }],
          ...(request.reasoningEffort === null
            ? {}
            : { output_config: { effort: request.reasoningEffort } }),
        },
        parse: (payload) => readMessage(payload, request.model),
      },
      signal,
    );
  }
}
