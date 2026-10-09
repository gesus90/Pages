import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { readChatCompletion, readModelList } from "./ProviderResponses";

import type { ProviderHttpClient } from "./ProviderHttpClient";
import type {
  ApiProviderAdapter,
  ModelTestRequest,
  ProviderCheckOutcome,
} from "./ProviderContracts";

/** Uses OpenAI's model listing for access checks and capped Chat Completions for tests. */
export class OpenAiProvider implements ApiProviderAdapter {
  public readonly provider = "openai";
  private readonly client: ProviderHttpClient;

  public constructor(client: ProviderHttpClient) {
    this.client = client;
  }

  /** Checks authentication without generating tokens. */
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

  /** Sends only the fixed diagnostic prompt, with a 16-token completion budget. */
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
          max_completion_tokens: 16,
        },
        parse: (payload) => readChatCompletion(payload, request.model),
      },
      signal,
    );
  }
}
