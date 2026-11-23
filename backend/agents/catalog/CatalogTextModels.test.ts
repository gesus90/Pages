import { describe, expect, it } from "vitest";

import {
  isCatalogModel,
  isDecisionOutputModel,
  isSpeechModel,
  isSpeechOutputModel,
  isTextModel,
} from "@/backend/agents/catalog/CatalogTextModels";

function openRouter(input: unknown, output: unknown): unknown {
  return {
    architecture: { input_modalities: input, output_modalities: output },
  };
}

describe("isTextModel", () => {
  it("decides OpenRouter models by their modalities", () => {
    expect(isTextModel(openRouter(["text"], ["text"]), "openrouter")).toBe(
      true,
    );
    expect(
      isTextModel(openRouter(["text"], ["text", "image"]), "openrouter"),
    ).toBe(true);
    expect(
      isTextModel(openRouter(["text"], ["embeddings"]), "openrouter"),
    ).toBe(false);
    expect(isTextModel(openRouter(["image"], ["text"]), "openrouter")).toBe(
      false,
    );
    expect(isTextModel(openRouter(["text"], ["image"]), "openrouter")).toBe(
      false,
    );
    expect(isTextModel(openRouter(["text"], "text"), "openrouter")).toBe(false);
    expect(isTextModel("nothing", "openrouter")).toBe(false);
  });

  it("decides Google models by generateContent", () => {
    expect(
      isTextModel(
        { supportedGenerationMethods: ["generateContent"] },
        "google_ai_studio",
      ),
    ).toBe(true);
    expect(
      isTextModel(
        { supportedGenerationMethods: ["embed"] },
        "google_ai_studio",
      ),
    ).toBe(false);
    expect(isTextModel({}, "google_ai_studio")).toBe(false);
  });

  it("keeps every OpenAI and Anthropic entry", () => {
    expect(isTextModel({}, "openai")).toBe(true);
    expect(isTextModel({}, "anthropic")).toBe(true);
  });
});

describe("special model kinds", () => {
  const speech = openRouter(["audio", 3], ["transcription"]);
  const speak = openRouter(["text"], ["speech"]);
  const decide = openRouter(["text"], ["decisions"]);

  it("recognises transcription, speech and decision models of OpenRouter", () => {
    expect(isSpeechModel(speech, "openrouter")).toBe(true);
    expect(isSpeechOutputModel(speak, "openrouter")).toBe(true);
    expect(isDecisionOutputModel(decide, "openrouter")).toBe(true);
    expect(isSpeechModel(speak, "openrouter")).toBe(false);
    expect(isSpeechOutputModel(speech, "openrouter")).toBe(false);
    expect(isDecisionOutputModel(speech, "openrouter")).toBe(false);
  });

  it("treats unstated modalities as none", () => {
    expect(isSpeechModel({}, "openrouter")).toBe(false);
  });

  it("ignores these kinds of every other provider", () => {
    expect(isSpeechModel(speech, "openai")).toBe(false);
    expect(isSpeechOutputModel(speak, "openai")).toBe(false);
    expect(isDecisionOutputModel(decide, "openai")).toBe(false);
  });

  it("keeps a model of any kind in the catalog", () => {
    for (const entry of [speech, speak, decide])
      expect(isCatalogModel(entry, "openrouter")).toBe(true);
    expect(
      isCatalogModel(openRouter(["text"], ["video-only"]), "openrouter"),
    ).toBe(false);
  });
});
