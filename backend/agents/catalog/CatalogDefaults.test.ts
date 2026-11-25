import { describe, expect, it } from "vitest";

import { defaultCatalogModel } from "@/backend/agents/catalog/CatalogDefaults";

import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

function model(
  id: string,
  extra: Partial<AgentCatalogModel> = {},
): AgentCatalogModel {
  return {
    id,
    name: id,
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    reasoning: "unknown",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    ...extra,
  };
}

describe("defaultCatalogModel", () => {
  it.each(["codex_cli", "claude_code", "anthropic"] as const)(
    "starts %s with the first listed model",
    (provider) => {
      expect(defaultCatalogModel(provider, [model("a"), model("b")])).toBe("a");
      expect(defaultCatalogModel(provider, [])).toBeNull();
    },
  );

  it.each(["openrouter", "opencode"] as const)(
    "starts %s with the free router, else the first free text model",
    (provider) => {
      expect(
        defaultCatalogModel(provider, [
          model("x", { isFree: true }),
          model("openrouter/free"),
        ]),
      ).toBe("openrouter/free");
      expect(
        defaultCatalogModel(provider, [
          model("paid"),
          model("speech", { isFree: true, inputModalities: ["audio"] }),
          model("plain", { isFree: true }),
        ]),
      ).toBe("plain");
      expect(
        defaultCatalogModel(provider, [
          model("text", { isFree: true, inputModalities: ["text"] }),
        ]),
      ).toBe("text");
      expect(defaultCatalogModel(provider, [model("paid")])).toBeNull();
    },
  );

  it.each(["openrouter", "opencode"] as const)(
    "starts %s with the first Z.AI Coding Plan text model when nothing is free",
    (provider) => {
      expect(
        defaultCatalogModel(provider, [
          model("paid"),
          model("zai-coding-plan/speech", { inputModalities: ["audio"] }),
          model("zai-coding-plan/glm-5.1"),
        ]),
      ).toBe("zai-coding-plan/glm-5.1");
      expect(
        defaultCatalogModel(provider, [
          model("zai-coding-plan/speech", { inputModalities: ["audio"] }),
        ]),
      ).toBeNull();
    },
  );

  it("starts Google with its latest Flash alias when listed", () => {
    expect(
      defaultCatalogModel("google_ai_studio", [
        model("models/gemini-flash-latest"),
      ]),
    ).toBe("models/gemini-flash-latest");
    expect(
      defaultCatalogModel("google_ai_studio", [model("other")]),
    ).toBeNull();
  });

  it.each(["antigravity", "openai"] as const)(
    "marks no default for %s",
    (p) => {
      expect(defaultCatalogModel(p, [model("a")])).toBeNull();
    },
  );
});
