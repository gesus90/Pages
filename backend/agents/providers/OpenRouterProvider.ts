import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";
import { openRouterCreditsSchema } from "@/definition/OpenRouterQuota";

import { readChatCompletion } from "./ProviderResponses";

import type { AgentCheckDetail } from "@/definition/AgentConnection";
import type {
  OpenRouterCredits,
  OpenRouterUsage,
} from "@/definition/OpenRouterQuota";
import type {
  ProviderHttpClient,
  ProviderReadOutcome,
} from "./ProviderHttpClient";
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

function readAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readUsage(payload: unknown): OpenRouterUsage | null {
  const fields = readAgentObject(readAgentObject(payload).data);
  const usage = readAmount(fields.usage);
  const limit =
    fields.limit === null ? null : (readAmount(fields.limit) ?? undefined);
  if (usage === null && limit === undefined) return null;
  const reset = fields.limit_reset;
  return {
    usage,
    limit,
    remaining:
      typeof limit === "number" ? readAmount(fields.limit_remaining) : null,
    reset:
      reset === "daily" || reset === "weekly" || reset === "monthly"
        ? reset
        : null,
  };
}

function readCredits(payload: unknown): OpenRouterCredits | null {
  const fields = readAgentObject(readAgentObject(payload).data);
  const parsed = openRouterCreditsSchema.safeParse({
    purchased: fields.total_credits,
    used: fields.total_usage,
  });
  return parsed.success ? parsed.data : null;
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

  /** Reads key usage and budget without making a model request. */
  public readUsage(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ProviderReadOutcome<OpenRouterUsage>> {
    return this.client.read(
      { provider: this.provider, apiKey, path: "/key", parse: readUsage },
      signal,
    );
  }

  /** Reads account credit totals with the separate management credential. */
  public readCredits(
    managementKey: string,
    signal: AbortSignal,
  ): Promise<ProviderReadOutcome<OpenRouterCredits>> {
    return this.client.read(
      {
        provider: this.provider,
        apiKey: managementKey,
        path: "/credits",
        parse: readCredits,
      },
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
