import { describe, expect, it } from "vitest";

import { parseCatalogPage } from "@/backend/agents/catalog/CatalogParsing";
import { AgentError } from "@/backend/error/AgentErrors";

function expectBadResponse(run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AgentError);
  expect(thrown).toMatchObject({ code: "provider_bad_response" });
}

function googleModel(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "models/gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    inputTokenLimit: 1_048_576,
    supportedGenerationMethods: ["generateContent", "countTokens"],
    ...fields,
  };
}

describe("parseCatalogPage for Google AI Studio", () => {
  it("uses the resource name as ID and reads the input token limit", () => {
    const { models, nextCursor } = parseCatalogPage(
      { models: [googleModel({ thinking: true })] },
      "google_ai_studio",
    );
    expect(nextCursor).toBeNull();
    expect(models).toEqual([
      {
        id: "models/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        contextWindow: 1_048_576,
        promptPrice: null,
        completionPrice: null,
        isFree: false,
        reasoning: "levels",
        reasoningEfforts: ["minimal", "low", "medium", "high"],
        defaultReasoningEffort: "medium",
      },
    ]);
  });

  it("falls back to the resource name when no display name is given", () => {
    const [model] = parseCatalogPage(
      { models: [googleModel({ displayName: undefined })] },
      "google_ai_studio",
    ).models;
    expect(model.name).toBe("models/gemini-3.5-flash");
  });

  it("keeps only models that support generateContent", () => {
    const { models } = parseCatalogPage(
      {
        models: [
          googleModel(),
          googleModel({
            name: "models/text-embedding-synthetic",
            supportedGenerationMethods: ["embedContent"],
          }),
        ],
      },
      "google_ai_studio",
    );
    expect(models.map((model) => model.id)).toEqual([
      "models/gemini-3.5-flash",
    ]);
  });

  it.each([
    ["thinking false", { thinking: false }, "none"],
    ["thinking not stated", {}, "unknown"],
    ["thinking not a boolean", { thinking: "yes" }, "unknown"],
    [
      "thinking on a model Google does not document",
      { name: "models/gemini-flash-latest", thinking: true },
      "automatic",
    ],
  ])("reports %s as %s", (_, fields, reasoning) => {
    const [model] = parseCatalogPage(
      { models: [googleModel(fields)] },
      "google_ai_studio",
    ).models;
    expect(model.reasoning).toBe(reasoning);
    expect(model.reasoningEfforts).toEqual([]);
  });

  it("returns the next page token as cursor", () => {
    const { nextCursor } = parseCatalogPage(
      { models: [googleModel()], nextPageToken: "token-2" },
      "google_ai_studio",
    );
    expect(nextCursor).toBe("token-2");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("ends the listing when the page token is %s", (_, nextPageToken) => {
    const { nextCursor } = parseCatalogPage(
      { models: [googleModel()], nextPageToken },
      "google_ai_studio",
    );
    expect(nextCursor).toBeNull();
  });

  it.each([
    ["a number", 12],
    ["text with a control character", "a\u0007b"],
    ["text over 2048 characters", "t".repeat(2049)],
  ])("rejects a page token that is %s", (_, nextPageToken) => {
    expectBadResponse(() =>
      parseCatalogPage(
        { models: [googleModel()], nextPageToken },
        "google_ai_studio",
      ),
    );
  });

  it("rejects a listing under the wrong key", () => {
    expectBadResponse(() =>
      parseCatalogPage({ data: [googleModel()] }, "google_ai_studio"),
    );
  });
});

describe("parseCatalogPage for OpenAI and Z.AI", () => {
  it.each(["openai", "zai"] as const)(
    "keeps every listed entry of %s with unknown reasoning",
    (provider) => {
      const { models, nextCursor } = parseCatalogPage(
        {
          object: "list",
          data: [
            { id: "gpt-synthetic", object: "model" },
            { id: "text-embedding-synthetic", object: "model" },
          ],
        },
        provider,
      );
      expect(models.map((model) => model.id)).toEqual([
        "gpt-synthetic",
        "text-embedding-synthetic",
      ]);
      expect(models[0]).toMatchObject({
        name: "gpt-synthetic",
        reasoning: "unknown",
        promptPrice: null,
        isFree: false,
      });
      expect(nextCursor).toBeNull();
    },
  );

  it("never presents a partial listing as complete", () => {
    expectBadResponse(() =>
      parseCatalogPage(
        { data: [{ id: "gpt-synthetic" }], has_more: true },
        "openai",
      ),
    );
  });

  it("prefers an explicit effort list when the listing provides one", () => {
    const [model] = parseCatalogPage(
      {
        data: [
          {
            id: "gpt-synthetic",
            reasoning: {
              supported_efforts: ["low", "high"],
              default_effort: "low",
            },
          },
        ],
      },
      "openai",
    ).models;
    expect(model).toMatchObject({
      reasoning: "levels",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "low",
    });
  });
});
