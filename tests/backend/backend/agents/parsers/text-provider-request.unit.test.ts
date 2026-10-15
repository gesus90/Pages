import { describe, expect, it } from "vitest";

import { createTextProviderRequest } from "@/backend/agents/providers/TextProviderPayload";

import {
  IMAGE_LABEL,
  NOTES_LABEL,
  TICKET_ASSETS,
  textInput,
} from "./text-provider-input";

describe("createTextProviderRequest for Google AI Studio", () => {
  it("addresses the model without its resource prefix", () => {
    const request = createTextProviderRequest(
      "google_ai_studio",
      textInput({ model: "models/gemini-3.5-flash" }),
    );
    expect(request.path).toBe("/models/gemini-3.5-flash:generateContent");
  });

  it("encodes characters that are not safe in a path segment", () => {
    const request = createTextProviderRequest(
      "google_ai_studio",
      textInput({ model: "models/tuned/a b?x" }),
    );
    expect(request.path).toBe("/models/tuned%2Fa%20b%3Fx:generateContent");
  });

  it("sends the prompt and a bounded output without optional parts", () => {
    const { body } = createTextProviderRequest(
      "google_ai_studio",
      textInput({ model: "gemini-3.5-flash" }),
    );
    expect(body).toEqual({
      contents: [{ parts: [{ text: "Translate this." }] }],
      generationConfig: { maxOutputTokens: 16_384 },
    });
  });

  it("adds instructions, search and the thinking level as the enum name", () => {
    const { body } = createTextProviderRequest(
      "google_ai_studio",
      textInput({
        instructions: "Be brief.",
        webSearch: true,
        reasoningEffort: "medium",
      }),
    );
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: "Be brief." }] },
      tools: [{ google_search: {} }],
      generationConfig: { thinkingConfig: { thinkingLevel: "MEDIUM" } },
    });
  });

  it("sends no search tool when search is switched off", () => {
    const { body } = createTextProviderRequest(
      "google_ai_studio",
      textInput({ webSearch: false }),
    );
    expect(body).not.toHaveProperty("tools");
  });

  it("encodes ticket assets as native parts after labelled text", () => {
    const { body } = createTextProviderRequest(
      "google_ai_studio",
      textInput(),
      TICKET_ASSETS,
    );
    expect(body.contents).toEqual([
      {
        parts: [
          { text: "Translate this." },
          { text: IMAGE_LABEL },
          { inlineData: { mimeType: "image/png", data: "QUJD" } },
          { text: NOTES_LABEL },
          { text: "plain notes" },
        ],
      },
    ]);
  });
});

describe("createTextProviderRequest for Anthropic", () => {
  it("sends the prompt as a plain user message", () => {
    const request = createTextProviderRequest(
      "anthropic",
      textInput({ model: "claude-synthetic" }),
    );
    expect(request).toEqual({
      path: "/messages",
      body: {
        model: "claude-synthetic",
        max_tokens: 16_384,
        messages: [{ role: "user", content: "Translate this." }],
      },
    });
  });

  it("adds system text, the server-side search tool and the effort", () => {
    const { body } = createTextProviderRequest(
      "anthropic",
      textInput({
        instructions: "Be brief.",
        webSearch: true,
        reasoningEffort: "high",
      }),
    );
    expect(body).toMatchObject({
      system: "Be brief.",
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      output_config: { effort: "high" },
    });
  });

  it("switches to content blocks when assets travel along", () => {
    const { body } = createTextProviderRequest(
      "anthropic",
      textInput(),
      TICKET_ASSETS,
    );
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Translate this." },
          { type: "text", text: IMAGE_LABEL },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "QUJD" },
          },
          { type: "text", text: NOTES_LABEL },
          { type: "text", text: "plain notes" },
        ],
      },
    ]);
  });
});

describe("createTextProviderRequest for chat completions", () => {
  it("builds the OpenAI request with a system message and no storage", () => {
    const request = createTextProviderRequest(
      "openai",
      textInput({ instructions: "Be brief.", reasoningEffort: "low" }),
    );
    expect(request).toEqual({
      path: "/chat/completions",
      body: {
        model: "model-1",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Translate this." },
        ],
        stream: false,
        max_completion_tokens: 16_384,
        store: false,
        reasoning_effort: "low",
      },
    });
  });

  it("pins OpenRouter to the chosen model, with nested reasoning and optional web plugin", () => {
    const { body } = createTextProviderRequest(
      "openrouter",
      textInput({ reasoningEffort: "high", webSearch: true }),
    );
    expect(body).toMatchObject({
      max_tokens: 16_384,
      provider: { allow_fallbacks: false },
      plugins: [{ id: "web" }],
      reasoning: { effort: "high" },
    });
    expect(body).not.toHaveProperty("store");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("gives Z.AI a plain token limit and ignores a search request", () => {
    const { path, body } = createTextProviderRequest(
      "zai",
      textInput({ webSearch: true }),
    );
    expect(path).toBe("/chat/completions");
    expect(body).toMatchObject({ max_tokens: 16_384, stream: false });
    expect(body).not.toHaveProperty("plugins");
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("store");
  });

  it("sends OpenAI images as data URLs in content parts", () => {
    const { body } = createTextProviderRequest(
      "openai",
      textInput(),
      TICKET_ASSETS,
    );
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Translate this." },
          { type: "text", text: IMAGE_LABEL },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,QUJD" },
          },
          { type: "text", text: NOTES_LABEL },
          { type: "text", text: "plain notes" },
        ],
      },
    ]);
  });
});

describe("createTextProviderRequest for the OpenAI Responses API", () => {
  it("is used for OpenAI only when search is requested", () => {
    const request = createTextProviderRequest(
      "openai",
      textInput({
        instructions: "Be brief.",
        webSearch: true,
        reasoningEffort: "low",
      }),
    );
    expect(request).toEqual({
      path: "/responses",
      body: {
        model: "model-1",
        instructions: "Be brief.",
        input: "Translate this.",
        tools: [{ type: "web_search" }],
        max_output_tokens: 16_384,
        store: false,
        reasoning: { effort: "low" },
      },
    });
  });

  it("wraps assets as input parts of one user message", () => {
    const { body } = createTextProviderRequest(
      "openai",
      textInput({ webSearch: true }),
      TICKET_ASSETS,
    );
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "Translate this." },
          { type: "input_text", text: IMAGE_LABEL },
          { type: "input_image", image_url: "data:image/png;base64,QUJD" },
          { type: "input_text", text: NOTES_LABEL },
          { type: "input_text", text: "plain notes" },
        ],
      },
    ]);
  });
});
