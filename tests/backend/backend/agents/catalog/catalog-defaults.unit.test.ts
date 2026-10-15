import { describe, expect, it } from "vitest";

import { defaultCatalogModel } from "@/backend/agents/catalog/CatalogDefaults";

import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

function model(id: string, isFree = false): AgentCatalogModel {
  return {
    id,
    name: id,
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree,
    reasoning: "unknown",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
  };
}

describe("defaultCatalogModel", () => {
  it.each(["codex_cli", "claude_code", "anthropic"] as const)(
    "takes the first listed model for %s",
    (provider) => {
      expect(
        defaultCatalogModel(provider, [model("first"), model("second")]),
      ).toBe("first");
    },
  );

  it.each(["codex_cli", "claude_code", "anthropic"] as const)(
    "has no default for an empty %s listing",
    (provider) => {
      expect(defaultCatalogModel(provider, [])).toBeNull();
    },
  );

  it.each(["openrouter", "opencode"] as const)(
    "prefers the free router for %s",
    (provider) => {
      const models = [
        model("vendor/paid"),
        model("vendor/free-one", true),
        model("openrouter/free", true),
      ];
      expect(defaultCatalogModel(provider, models)).toBe("openrouter/free");
    },
  );

  it.each(["openrouter", "opencode"] as const)(
    "falls back to the first free model for %s",
    (provider) => {
      const models = [
        model("vendor/paid"),
        model("vendor/free-one", true),
        model("vendor/free-two", true),
      ];
      expect(defaultCatalogModel(provider, models)).toBe("vendor/free-one");
    },
  );

  it.each(["openrouter", "opencode"] as const)(
    "never picks a model that costs money for %s",
    (provider) => {
      expect(defaultCatalogModel(provider, [model("vendor/paid")])).toBeNull();
    },
  );

  it("starts Google with the latest Flash alias only when it is listed", () => {
    const listed = [
      model("models/gemini-3.5-pro"),
      model("models/gemini-flash-latest"),
    ];
    expect(defaultCatalogModel("google_ai_studio", listed)).toBe(
      "models/gemini-flash-latest",
    );
    expect(
      defaultCatalogModel("google_ai_studio", [model("models/gemini-3.5-pro")]),
    ).toBeNull();
  });

  it.each(["openai", "zai"] as const)(
    "leaves the choice to the administrator for %s",
    (provider) => {
      expect(
        defaultCatalogModel(provider, [model("gpt-synthetic")]),
      ).toBeNull();
    },
  );
});
