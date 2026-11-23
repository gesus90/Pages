import { describe, expect, it } from "vitest";

import {
  isCatalogModelId,
  parseCatalogPage,
  parseStoredCatalog,
} from "@/backend/agents/catalog/CatalogParsing";
import { AgentError } from "@/backend/error/AgentErrors";

function codeOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error instanceof AgentError ? error.code : error;
  }
  return null;
}

function openRouterPage(
  entries: unknown[],
  extra: Record<string, unknown> = {},
): unknown {
  return { data: entries, ...extra };
}

function chat(id: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    ...extra,
  };
}

describe("isCatalogModelId", () => {
  it("rejects non-strings and overlong IDs", () => {
    expect(isCatalogModelId(3)).toBe(false);
    expect(isCatalogModelId("a".repeat(201))).toBe(false);
  });
});

describe("parseCatalogPage models", () => {
  it("reads OpenRouter metadata, prices and voices", () => {
    const page = parseCatalogPage(
      openRouterPage([
        chat("vendor/free", {
          name: "Free model",
          context_length: 4096,
          pricing: { prompt: "0", completion: 0 },
          supported_parameters: ["tools"],
          supported_voices: ["alloy", "alloy", "nova"],
          reasoning: {
            supported_efforts: ["low", "high"],
            default_effort: "high",
          },
        }),
        chat("vendor/paid", {
          display_name: "Paid",
          context_length: -1,
          pricing: { prompt: "0.5e-6", completion: "bad" },
          supported_parameters: ["other"],
        }),
        { id: "vendor/noarch", architecture: { input_modalities: "x" } },
        chat("vendor/mods", {
          name: "x\u0001y",
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
        }),
        chat("vendor/badmods", {
          name: "",
          architecture: {
            input_modalities: ["text", 1],
            output_modalities: Array.from({ length: 17 }, () => "text"),
          },
        }),
      ]),
      "openrouter",
    );
    const [free, paid, mods, badMods] = page.models;
    expect(free).toMatchObject({
      id: "vendor/free",
      name: "Free model",
      contextWindow: 4096,
      promptPrice: "0",
      completionPrice: "0",
      isFree: true,
      reasoning: "levels",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "high",
      isToolCapable: true,
      supportedVoices: ["alloy", "nova"],
      supportsImages: false,
    });
    expect(paid).toMatchObject({
      name: "Paid",
      contextWindow: null,
      promptPrice: "0.5e-6",
      completionPrice: null,
      isFree: false,
      isToolCapable: false,
      reasoning: "none",
    });
    expect(mods).toMatchObject({
      name: "vendor/mods",
      supportsImages: true,
      inputModalities: ["text", "image"],
    });
    expect(badMods.name).toBe("vendor/badmods");
    expect(badMods).not.toHaveProperty("outputModalities");
    expect(page.nextCursor).toBeNull();
  });
});

describe("parseCatalogPage voices", () => {
  it("rejects unusable voice lists", () => {
    const voices = (list: unknown): unknown =>
      parseCatalogPage(
        openRouterPage([chat("vendor/v", { supported_voices: list })]),
        "openrouter",
      ).models[0];
    expect(voices([])).not.toHaveProperty("supportedVoices");
    expect(voices("x")).not.toHaveProperty("supportedVoices");
    expect(voices(["ok", "bad\n"])).not.toHaveProperty("supportedVoices");
    expect(voices(Array.from({ length: 501 }, () => "a"))).not.toHaveProperty(
      "supportedVoices",
    );
  });
});

describe("parseCatalogPage OpenRouter reasoning", () => {
  it("derives OpenRouter reasoning from its documented forms", () => {
    const reasoning = (value: unknown): unknown =>
      parseCatalogPage(
        openRouterPage([chat("vendor/r", { reasoning: value })]),
        "openrouter",
      ).models[0];
    expect(
      reasoning({ supported_efforts: null, mandatory: true }),
    ).toMatchObject({
      reasoning: "levels",
      reasoningEfforts: ["max", "xhigh", "high", "medium", "low", "minimal"],
      defaultReasoningEffort: null,
    });
    expect(reasoning({ supported_efforts: null })).toMatchObject({
      reasoningEfforts: [
        "max",
        "xhigh",
        "high",
        "medium",
        "low",
        "minimal",
        "none",
      ],
    });
    expect(reasoning({ supports_max_tokens: true })).toMatchObject({
      reasoning: "levels",
    });
    expect(reasoning({})).toMatchObject({ reasoning: "automatic" });
    expect(reasoning({ supported_efforts: ["Bad Value"] })).toMatchObject({
      reasoning: "automatic",
    });
    expect(
      reasoning({ supported_efforts: ["low"], default_effort: "high" }),
    ).toMatchObject({ defaultReasoningEffort: null });
  });
});

describe("parseCatalogPage other reasoning", () => {
  it("reads reasoning efforts listed by other providers", () => {
    const page = parseCatalogPage(
      {
        data: [
          {
            id: "gpt-x",
            reasoning: { supported_efforts: ["low", "low"] },
          },
          { id: "gpt-y" },
          { id: "gpt-z", reasoning: { supported_efforts: [] } },
        ],
      },
      "openai",
    );
    expect(page.models[0].reasoningEfforts).toEqual(["low"]);
    expect(page.models[1].reasoning).toBe("unknown");
    expect(page.models[2].reasoning).toBe("unknown");
    const tooMany = parseCatalogPage(
      {
        data: [
          {
            id: "gpt-q",
            reasoning: {
              supported_efforts: Array.from({ length: 9 }, (_, i) => `e${i}`),
            },
          },
        ],
      },
      "openai",
    );
    expect(tooMany.models[0].reasoning).toBe("unknown");
  });
});

describe("parseCatalogPage image input", () => {
  it("takes an explicit image_input flag", () => {
    const page = parseCatalogPage(
      { data: [{ id: "gpt-i", image_input: true }] },
      "openai",
    );
    expect(page.models[0].supportsImages).toBe(true);
  });
});

describe("parseCatalogPage Anthropic and Google", () => {
  it("reads Anthropic capabilities and cursors", () => {
    const supported = { supported: true };
    const page = parseCatalogPage(
      {
        data: [
          {
            id: "claude-a",
            display_name: "Claude A",
            capabilities: {
              effort: {
                supported: true,
                max: supported,
                low: supported,
                medium: { supported: false },
                bogus: supported,
                Upper: supported,
              },
            },
          },
          { id: "claude-b" },
          { id: "claude-c", capabilities: { effort: { supported: false } } },
          { id: "claude-d", capabilities: { effort: { supported: true } } },
          {
            id: "claude-e",
            capabilities: { effort: { supported: true, "x-1": supported } },
          },
        ],
        has_more: true,
        last_id: "claude-e",
      },
      "anthropic",
    );
    expect(page.models.map((model) => model.reasoning)).toEqual([
      "levels",
      "unknown",
      "none",
      "none",
      "levels",
    ]);
    expect(page.models[0].reasoningEfforts).toEqual(["low", "max", "bogus"]);
    expect(page.models[4].reasoningEfforts).toEqual(["x-1"]);
    expect(page.nextCursor).toBe("claude-e");
    expect(
      parseCatalogPage({ data: [], has_more: false }, "anthropic").nextCursor,
    ).toBeNull();
    expect(
      parseCatalogPage(
        { data: [{ id: "c", capabilities: null }], has_more: false },
        "anthropic",
      ).models[0].reasoning,
    ).toBe("unknown");
  });
});

describe("parseCatalogPage Anthropic cursors", () => {
  it("rejects malformed Anthropic cursors", () => {
    expect(codeOf(() => parseCatalogPage({ data: [] }, "anthropic"))).toBe(
      "provider_bad_response",
    );
    expect(
      codeOf(() =>
        parseCatalogPage(
          { data: [], has_more: true, last_id: "" },
          "anthropic",
        ),
      ),
    ).toBe("provider_bad_response");
  });
});

describe("parseCatalogPage Google", () => {
  it("reads Google models, thinking and cursors", () => {
    const generate = ["generateContent"];
    const page = parseCatalogPage(
      {
        models: [
          {
            name: "models/gemini-3.5-flash",
            displayName: "Flash",
            inputTokenLimit: 1000,
            supportedGenerationMethods: generate,
            thinking: true,
          },
          {
            name: "models/gemini-flash-latest",
            supportedGenerationMethods: generate,
            thinking: true,
          },
          {
            name: "models/a",
            supportedGenerationMethods: generate,
            thinking: false,
          },
          { name: "models/b", supportedGenerationMethods: generate },
        ],
        nextPageToken: "tok",
      },
      "google_ai_studio",
    );
    expect(page.models.map((model) => model.reasoning)).toEqual([
      "levels",
      "automatic",
      "none",
      "unknown",
    ]);
    expect(page.models[0].defaultReasoningEffort).toBe("medium");
    expect(page.nextCursor).toBe("tok");
    for (const result of [{ models: [] }, { models: [], nextPageToken: "" }])
      expect(
        parseCatalogPage(result, "google_ai_studio").nextCursor,
      ).toBeNull();
    expect(
      codeOf(() =>
        parseCatalogPage({ models: [], nextPageToken: 5 }, "google_ai_studio"),
      ),
    ).toBe("provider_bad_response");
  });
});

describe("parseCatalogPage structure and pagination", () => {
  it("rejects bad entries and pages", () => {
    expect(codeOf(() => parseCatalogPage({}, "openai"))).toBe(
      "provider_bad_response",
    );
    expect(
      codeOf(() => parseCatalogPage({ data: [{ id: "bad id" }] }, "openai")),
    ).toBe("provider_bad_response");
    expect(
      codeOf(() =>
        parseCatalogPage({ data: new Array(10_001).fill(null) }, "openai"),
      ),
    ).toBe("provider_bad_response");
    expect(
      codeOf(() => parseCatalogPage({ data: [], has_more: true }, "openai")),
    ).toBe("provider_bad_response");
    expect(parseCatalogPage({ data: [] }, "openai").nextCursor).toBeNull();
  });

  it("computes the next OpenRouter offset", () => {
    const entries = [chat("vendor/a"), chat("vendor/b")];
    expect(
      parseCatalogPage(
        openRouterPage(entries, { total_count: 5 }),
        "openrouter",
        1,
      ).nextCursor,
    ).toBe("3");
    expect(
      parseCatalogPage(
        openRouterPage(entries, { total_count: 2 }),
        "openrouter",
      ).nextCursor,
    ).toBeNull();
    expect(
      parseCatalogPage(openRouterPage(new Array(1000).fill(null)), "openrouter")
        .nextCursor,
    ).toBe("1000");
    for (const extra of [
      { has_more: true },
      { total_count: "5" },
      { total_count: 1.5 },
      { total_count: 1 },
    ])
      expect(
        codeOf(() =>
          parseCatalogPage(openRouterPage(entries, extra), "openrouter"),
        ),
      ).toBe("provider_bad_response");
    expect(
      codeOf(() =>
        parseCatalogPage(
          openRouterPage([], { total_count: 5 }),
          "openrouter",
          3,
        ),
      ),
    ).toBe("provider_bad_response");
  });
});

describe("parseStoredCatalog", () => {
  it("restores reasoning, aliases, tools and modalities", () => {
    const models = parseStoredCatalog([
      {
        id: "claude-opus-5-5",
        name: "Opus",
        reasoning_support: "levels",
        reasoning: {
          supported_efforts: ["low", "high"],
          default_effort: "low",
        },
        aliases: ["opus", "Bad", "opus[1m]"],
        tool_call: true,
        input_modalities: ["text"],
        output_modalities: ["text"],
      },
      { id: "plain", reasoning_support: "levels", reasoning: {} },
      { id: "auto", reasoning_support: "automatic", aliases: ["Bad"] },
      { id: "old", reasoning_support: "weird", tool_call: "yes" },
      { id: "zai/glm" },
    ]);
    expect(models).toHaveLength(4);
    expect(models[0]).toMatchObject({
      reasoning: "levels",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "low",
      aliases: ["opus", "opus[1m]"],
      isToolCapable: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
    });
    expect(models[1].reasoning).toBe("unknown");
    expect(models[2]).toMatchObject({ reasoning: "automatic" });
    expect(models[2]).not.toHaveProperty("aliases");
    expect(models[3].reasoning).toBe("unknown");
    expect(models[3]).not.toHaveProperty("isToolCapable");
    expect(models[3]).not.toHaveProperty("inputModalities");
  });
});
