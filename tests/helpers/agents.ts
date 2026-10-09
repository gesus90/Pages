import type {
  AgentConnectionSummary,
  CliToolLocations,
} from "@/definition/AgentConnection";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

/** Safe metadata fixture; no stored credential material is part of the UI contract. */
export function createAgentConnection(
  overrides: Partial<AgentConnectionSummary> = {},
): AgentConnectionSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test connection",
    provider: "openai",
    accessKind: "api_key",
    hasApiKey: true,
    testModel: null,
    reasoningEffort: null,
    cli: null,
    checks: { auth: null, model: null },
    updatedAt: "2026-10-08T10:00:00.000Z",
    ...overrides,
  };
}

/** Creates an isolated CLI metadata fixture without accessing any installed CLI. */
export function createCliConnection(
  overrides: Partial<AgentConnectionSummary> = {},
): AgentConnectionSummary {
  return createAgentConnection({
    accessKind: "cli_account",
    provider: "codex_cli",
    hasApiKey: false,
    cli: {
      binaryFound: true,
      loggedInAt: null,
      accountLabel: null,
      login: null,
      terminalCommand:
        "env -i HOME=/synthetic/agents/home /synthetic/bin/codex login --device-auth",
    },
    ...overrides,
  });
}

export const CLI_LOCATIONS: CliToolLocations = {
  codex_cli: { found: true, path: "/synthetic/bin/codex" },
  claude_code: { found: false, path: null },
};

/** Catalog entry fixture; reasoning stays `unknown` unless a test names levels. */
export function createCatalogModel(
  overrides: Partial<AgentCatalogModel> = {},
): AgentCatalogModel {
  return {
    id: "vendor/model",
    name: "Model",
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    reasoning: "unknown",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    ...overrides,
  };
}
