import { describe, expect, it } from "vitest";

import { isTextModel } from "@/backend/agents/catalog/CatalogTextModels";

function openRouterEntry(
  input: readonly unknown[] | undefined,
  output: readonly unknown[] | undefined,
): unknown {
  return {
    id: "vendor/model",
    architecture: { input_modalities: input, output_modalities: output },
  };
}

describe("isTextModel for OpenRouter", () => {
  it("accepts a model that reads text and writes only text", () => {
    expect(isTextModel(openRouterEntry(["text"], ["text"]), "openrouter")).toBe(
      true,
    );
  });

  it("accepts a multimodal input as long as text is among the inputs", () => {
    const entry = openRouterEntry(["image", "text"], ["text"]);
    expect(isTextModel(entry, "openrouter")).toBe(true);
  });

  it.each([
    ["an image generator", ["text"], ["image"]],
    ["a model that also writes images", ["text"], ["text", "image"]],
    ["a speech model", ["audio"], ["text"]],
    ["an embedding model", ["text"], ["embeddings"]],
    ["a model without outputs", ["text"], []],
  ])("refuses %s", (_, input, output) => {
    expect(isTextModel(openRouterEntry(input, output), "openrouter")).toBe(
      false,
    );
  });

  it.each([
    ["no architecture", { id: "vendor/model" }],
    [
      "modalities that are not lists",
      {
        architecture: { input_modalities: "text", output_modalities: "text" },
      },
    ],
    ["missing modalities", openRouterEntry(undefined, undefined)],
    ["a non-object entry", null],
  ])("refuses an entry with %s", (_, entry) => {
    expect(isTextModel(entry, "openrouter")).toBe(false);
  });
});

describe("isTextModel for Google AI Studio", () => {
  it("accepts models that support generateContent", () => {
    const entry = {
      name: "models/gemini-3.5-flash",
      supportedGenerationMethods: ["countTokens", "generateContent"],
    };
    expect(isTextModel(entry, "google_ai_studio")).toBe(true);
  });

  it.each([
    ["an embedding model", ["embedContent"]],
    ["an answer-only model", ["generateAnswer"]],
    ["a model without methods", []],
  ])("refuses %s", (_, methods) => {
    const entry = { name: "models/x", supportedGenerationMethods: methods };
    expect(isTextModel(entry, "google_ai_studio")).toBe(false);
  });

  it("refuses an entry that lists no methods at all", () => {
    expect(isTextModel({ name: "models/x" }, "google_ai_studio")).toBe(false);
  });
});

describe("isTextModel for providers without modality data", () => {
  it.each(["openai", "anthropic", "zai"] as const)(
    "keeps every entry of %s, whatever its name suggests",
    (provider) => {
      expect(isTextModel({ id: "text-embedding-3-large" }, provider)).toBe(
        true,
      );
      expect(isTextModel(null, provider)).toBe(true);
    },
  );
});
