import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

// OpenRouter's own router that only routes to free models.
const OPENROUTER_FREE_ROUTER = "openrouter/free";
// Google's documented alias for its latest Flash release.
const GOOGLE_FLASH_LATEST = "models/gemini-flash-latest";

function listed(
  models: readonly AgentCatalogModel[],
  id: string,
): string | null {
  return models.some((model) => model.id === id) ? id : null;
}

/**
 * Picks the model a connection starts with, using only the listed models.
 *
 * @param provider - The connection's provider.
 * @param models - The freshly listed models, in the order the catalog keeps.
 * @returns A listed model ID, or `null` when the source marks no default.
 *
 * @remarks
 * Each rule follows what the provider or CLI documents:
 * - Codex lists its models in its own priority order, Claude Code names its
 *   aliases in its help, and Anthropic lists newer models first, so their first
 *   entry is the default.
 * - OpenRouter starts with its free router, otherwise its first free model, so
 *   a default never incurs costs.
 * - Google starts with its "latest Flash" alias when listed.
 * - OpenAI's listing marks no default and also contains models that cannot
 *   chat, so OpenAI and Z.AI get none and the administrator chooses.
 */
export function defaultCatalogModel(
  provider: AgentProviderId,
  models: readonly AgentCatalogModel[],
): string | null {
  switch (provider) {
    case "codex_cli":
    case "claude_code":
    case "anthropic":
      return models.at(0)?.id ?? null;
    case "openrouter":
      return (
        listed(models, OPENROUTER_FREE_ROUTER) ??
        models.find((model) => model.isFree)?.id ??
        null
      );
    case "google_ai_studio":
      return listed(models, GOOGLE_FLASH_LATEST);
    case "openai":
    case "zai":
      return null;
  }
}
