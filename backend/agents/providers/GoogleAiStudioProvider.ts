import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import type { AgentCheckDetail } from "@/definition/AgentConnection";
import type { ProviderHttpClient } from "./ProviderHttpClient";
import type {
  ApiProviderAdapter,
  ModelTestRequest,
  ProviderCheckOutcome,
} from "./ProviderContracts";

function readModels(payload: unknown): AgentCheckDetail | null {
  const result = readAgentObject(payload);
  if (!Array.isArray(result.models)) return null;
  if (
    !result.models.every(
      (entry: unknown) => typeof readAgentObject(entry).name === "string",
    )
  )
    return null;
  return {
    modelCount: result.models.length,
    hasMoreModels:
      typeof result.nextPageToken === "string" &&
      result.nextPageToken.length > 0,
  };
}

function readGeneration(
  payload: unknown,
  model: string,
): AgentCheckDetail | null {
  const result = readAgentObject(payload);
  if (!Array.isArray(result.candidates) || result.candidates.length === 0)
    return null;
  const candidate = readAgentObject(result.candidates[0]);
  const content = readAgentObject(candidate.content);
  if (!Array.isArray(content.parts) && candidate.finishReason !== "MAX_TOKENS")
    return null;
  const usage = readAgentObject(result.usageMetadata);
  return sanitizeCheckDetail({
    model,
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
  });
}

/** Gemini authentication always travels in x-goog-api-key, never in the URL. */
export class GoogleAiStudioProvider implements ApiProviderAdapter {
  public readonly provider = "google_ai_studio";
  private readonly client: ProviderHttpClient;

  public constructor(client: ProviderHttpClient) {
    this.client = client;
  }

  /** Reads a single page without generating tokens or following pagination. */
  public checkAccess(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.client.check(
      {
        provider: this.provider,
        apiKey,
        path: "/models?pageSize=1000",
        parse: readModels,
      },
      signal,
    );
  }

  /** Encodes the model identifier so it cannot alter the host or query string. */
  public runModelTest(
    request: ModelTestRequest,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const model = request.model.replace(/^models\//, "");
    return this.client.check(
      {
        provider: this.provider,
        apiKey: request.apiKey,
        path: `/models/${encodeURIComponent(model)}:generateContent`,
        body: {
          contents: [{ parts: [{ text: MODEL_TEST_PROMPT }] }],
          generationConfig: { maxOutputTokens: 16 },
        },
        parse: (payload) => readGeneration(payload, request.model),
      },
      signal,
    );
  }
}
