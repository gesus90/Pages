import type { PageAgentModel } from "@/definition/PageAgent";

/** A local OpenRouter model of the connection `connection`; `overrides` change single fields. */
export function pageModel(
  id: string,
  overrides: Partial<PageAgentModel> = {},
): PageAgentModel {
  return {
    id,
    connectionId: "connection",
    connectionName: "Shared connection",
    name: `Model ${id}`,
    model: `vendor/${id}`,
    reasoning: "none",
    reasoningEfforts: [],
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
    provider: "openrouter",
    ...overrides,
  };
}
