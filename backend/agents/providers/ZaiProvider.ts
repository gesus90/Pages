import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { documentedZaiModel } from "../catalog/DocumentedZaiModels";
import { readChatCompletion, readModelList } from "./ProviderResponses";
import { readZaiQuota } from "./ZaiQuotaResponse";

import type { ZaiAccountType } from "@/definition/AgentConnection";
import type { ZaiQuotaReading } from "@/definition/ZaiQuota";

import type {
  ProviderHttpClient,
  ProviderReadOutcome,
} from "./ProviderHttpClient";
import type {
  ApiProviderAdapter,
  ModelTestRequest,
  ProviderCheckOutcome,
} from "./ProviderContracts";

/**
 * The fixed international usage monitor, the same for both account types.
 * @remarks
 * It is not part of the documented model API; the usage plugin of Z.AI reads
 * the same route, with the key as the whole `Authorization` value.
 */
const USAGE_MONITOR_ENDPOINT = "https://api.z.ai/api/monitor";

/**
 * The thinking fields of a model test.
 * @remarks
 * A documented GLM 5.3 model always reasons and rejects
 * `thinking.type: disabled`, so its test asks for thinking at the chosen or
 * the lowest documented level. Any other model is tested without thinking.
 */
function modelTestThinking(
  request: ModelTestRequest,
): Readonly<Record<string, unknown>> {
  const documented = documentedZaiModel(request.model);
  if (documented === null) return { thinking: { type: "disabled" } };
  return {
    thinking: { type: "enabled" },
    reasoning_effort: request.reasoningEffort ?? documented.efforts[0],
  };
}

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

  /**
   * Reads the usage entries and the plan tier of a key without a model call.
   * @remarks
   * `GET /usage/quota/limit` of the usage monitor needs only the key of the
   * connection; it starts no model turn and uses none of the allowance it
   * reads.
   */
  public readQuota(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ProviderReadOutcome<ZaiQuotaReading>> {
    return this.client.read(
      {
        provider: this.provider,
        apiKey,
        endpoint: USAGE_MONITOR_ENDPOINT,
        isKeySentWithoutScheme: true,
        path: "/usage/quota/limit",
        parse: readZaiQuota,
      },
      signal,
    );
  }

  /** Runs an explicitly chosen model with the lowest thinking it allows and a 16-token cap. */
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
          ...modelTestThinking(request),
        },
        parse: (payload) => readChatCompletion(payload, request.model),
      },
      signal,
    );
  }
}
