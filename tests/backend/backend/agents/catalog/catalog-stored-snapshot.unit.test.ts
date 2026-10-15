import { describe, expect, it } from "vitest";

import { parseStoredCatalog } from "@/backend/agents/catalog/CatalogParsing";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

/** The projection the catalog repository writes to `models_json`. */
function serialize(model: AgentCatalogModel): Record<string, unknown> {
  return {
    id: model.id,
    name: model.name,
    context_length: model.contextWindow,
    pricing: { prompt: model.promptPrice, completion: model.completionPrice },
    reasoning_support: model.reasoning,
    reasoning: {
      supported_efforts: model.reasoningEfforts,
      default_effort: model.defaultReasoningEffort,
    },
  };
}

const LEVELS: AgentCatalogModel = {
  id: "vendor/levels",
  name: "Levels",
  contextWindow: 64_000,
  promptPrice: "0.000001",
  completionPrice: "0.000002",
  isFree: false,
  reasoning: "levels",
  reasoningEfforts: ["low", "high"],
  defaultReasoningEffort: "high",
};
const FREE: AgentCatalogModel = {
  id: "vendor/free",
  name: "Free",
  contextWindow: null,
  promptPrice: "0",
  completionPrice: "0",
  isFree: true,
  reasoning: "automatic",
  reasoningEfforts: [],
  defaultReasoningEffort: null,
};

describe("parseStoredCatalog", () => {
  it("reads back what the repository stored, unchanged", () => {
    const stored = [LEVELS, FREE].map(serialize);
    expect(parseStoredCatalog(stored)).toEqual([LEVELS, FREE]);
  });

  it.each(["none", "unknown", "automatic"] as const)(
    "restores the support %s without efforts",
    (reasoning) => {
      const model = { ...FREE, reasoning };
      expect(parseStoredCatalog([serialize(model)])).toEqual([model]);
    },
  );

  it("treats a snapshot from before reasoning data as unknown support", () => {
    const legacy = {
      id: "vendor/legacy",
      name: "Legacy",
      context_length: 8_000,
      pricing: { prompt: "0.5", completion: "0.5" },
    };
    expect(parseStoredCatalog([legacy])).toEqual([
      {
        id: "vendor/legacy",
        name: "Legacy",
        contextWindow: 8_000,
        promptPrice: "0.5",
        completionPrice: "0.5",
        isFree: false,
        reasoning: "unknown",
        reasoningEfforts: [],
        defaultReasoningEffort: null,
      },
    ]);
  });

  it("downgrades stored levels without a usable effort list to unknown", () => {
    const broken = {
      ...serialize(LEVELS),
      reasoning: { supported_efforts: [], default_effort: "high" },
    };
    const [model] = parseStoredCatalog([broken]);
    expect(model).toMatchObject({
      reasoning: "unknown",
      reasoningEfforts: [],
      defaultReasoningEffort: null,
    });
  });

  it("does not trust a stored default that is not among the efforts", () => {
    const stored = {
      ...serialize(LEVELS),
      reasoning: { supported_efforts: ["low"], default_effort: "high" },
    };
    expect(parseStoredCatalog([stored])[0].defaultReasoningEffort).toBeNull();
  });

  it("returns an empty list for an empty snapshot", () => {
    expect(parseStoredCatalog([])).toEqual([]);
  });

  it.each([
    ["a snapshot that is not a list", {}],
    ["an entry with an unusable ID", [{ ...serialize(LEVELS), id: "bad id" }]],
    ["an entry that is no object", [null]],
  ])("rejects %s", (_, entries) => {
    let thrown: unknown;
    try {
      parseStoredCatalog(entries);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AgentError);
    expect(thrown).toMatchObject({ code: "provider_bad_response" });
  });
});
