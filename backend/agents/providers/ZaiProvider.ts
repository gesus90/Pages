import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

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
