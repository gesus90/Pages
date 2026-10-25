import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { readChatCompletion, readModelList } from "./ProviderResponses";

import type { ZaiAccountType } from "@/definition/AgentConnection";

import type { ProviderHttpClient } from "./ProviderHttpClient";
import type {
  ApiProviderAdapter,
  ModelTestRequest,
  ProviderCheckOutcome,
} from "./ProviderContracts";

/** Uses the fixed international endpoint of the explicitly saved account type. */
export class ZaiProvider implements ApiProviderAdapter {
  public readonly provider = "zai";
  private readonly client: ProviderHttpClient;

  public constructor(client: ProviderHttpClient) {
    this.client = client;
  }

  /** Checks authentication through metadata, without consuming a model or subscription quota. */
  public checkAccess(
    apiKey: string,
    signal: AbortSignal,
    zaiAccountType?: ZaiAccountType,
  ): Promise<ProviderCheckOutcome> {
    return this.client.check(
      {
        provider: this.provider,
        apiKey,
        zaiAccountType,
        path: "/models",
        parse: readModelList,
      },
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
        zaiAccountType: request.zaiAccountType,
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
