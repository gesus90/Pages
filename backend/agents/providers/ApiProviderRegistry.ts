import { AnthropicProvider } from "./AnthropicProvider";
import { GoogleAiStudioProvider } from "./GoogleAiStudioProvider";
import { OpenAiProvider } from "./OpenAiProvider";
import { OpenRouterProvider } from "./OpenRouterProvider";
import { ProviderHttpClient } from "./ProviderHttpClient";
import { ZaiProvider } from "./ZaiProvider";

import type { ApiProviderId } from "@/definition/AgentConnection";
import type { ApiProviderAdapter } from "./ProviderContracts";

/** Wires stateless API adapters to one injectable, non-retrying HTTP transport. */
export function createApiProviderRegistry(
  client: ProviderHttpClient = new ProviderHttpClient(),
): Readonly<Record<ApiProviderId, ApiProviderAdapter>> {
  return {
    openrouter: new OpenRouterProvider(client),
    openai: new OpenAiProvider(client),
    google_ai_studio: new GoogleAiStudioProvider(client),
    zai: new ZaiProvider(client),
    anthropic: new AnthropicProvider(client),
  };
}
