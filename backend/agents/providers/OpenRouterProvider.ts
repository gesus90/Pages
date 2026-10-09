import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { readChatCompletion } from "./ProviderResponses";

import type { AgentCheckDetail } from "@/definition/AgentConnection";
import type { ProviderHttpClient } from "./ProviderHttpClient";
import type {
  ApiProviderAdapter,
  ModelTestRequest,
  ProviderCheckOutcome,
} from "./ProviderContracts";

function readKeyStatus(payload: unknown): AgentCheckDetail | null {
  const keyStatus = readAgentObject(readAgentObject(payload).data);
  if (typeof keyStatus.is_free_tier !== "boolean") return null;
  return sanitizeCheckDetail({
    limitRemaining: keyStatus.limit_remaining,
    isFreeTier: keyStatus.is_free_tier,
  });
}

/** The authenticated key endpoint proves access; the public model list does not. */
export class OpenRouterProvider implements ApiProviderAdapter {
  public readonly provider = "openrouter";
  private readonly client: ProviderHttpClient;

  public constructor(client: ProviderHttpClient) {
    this.client = client;
  }

  /** Reports only remaining allowance and free-tier status, never the key label. */
  public checkAccess(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.client.check(
      { provider: this.provider, apiKey, path: "/key", parse: readKeyStatus },
      signal,
    );
  }

  /** Checks structured errors even when OpenRouter wraps them in HTTP 200. */
  public runModelTest(
    request: ModelTestRequest,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.client.check(
      {
        provider: this.provider,
        apiKey: request.apiKey,
        path: "/chat/completions",
        body: {
          model: request.model,
          messages: [{ role: "user", content: MODEL_TEST_PROMPT }],
          max_tokens: 16,
          ...(request.reasoningEffort === null
            ? {}
            : { reasoning: { effort: request.reasoningEffort } }),
        },
        parse: (payload) => readChatCompletion(payload, request.model),
      },
      signal,
    );
  }
}
