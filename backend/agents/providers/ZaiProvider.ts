import {
  MODEL_TEST_PROMPT,
  ZAI_FREE_MODEL,
} from "@/definition/AgentConnection";

import { readChatCompletion } from "./ProviderResponses";

import type { ProviderHttpClient } from "./ProviderHttpClient";
import type {
  ApiProviderAdapter,
  ModelTestRequest,
  ProviderCheckOutcome,
} from "./ProviderContracts";

/** Uses the international standard API, never a Coding Plan or custom endpoint. */
export class ZaiProvider implements ApiProviderAdapter {
  public readonly provider = "zai";
  private readonly client: ProviderHttpClient;

  public constructor(client: ProviderHttpClient) {
    this.client = client;
  }

  /** The documented free model supplies a one-token access probe. */
  public checkAccess(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.complete(
      { apiKey, model: ZAI_FREE_MODEL, reasoningEffort: null },
      1,
      signal,
    );
  }

  /** Runs an explicitly chosen model with thinking disabled and a 16-token cap. */
  public runModelTest(
    request: ModelTestRequest,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.complete(request, 16, signal);
  }

  private complete(
    request: ModelTestRequest,
    maximumTokens: number,
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
          max_tokens: maximumTokens,
          thinking: { type: "disabled" },
        },
        parse: (payload) => readChatCompletion(payload, request.model),
      },
      signal,
    );
  }
}
