import { describe, expect, it } from "vitest";

import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import {
  createTextProviderRequest,
  readTextProviderResponse,
} from "@/backend/agents/providers/TextProviderPayload";

import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

function input(
  overrides: Partial<TextExecutionInput> = {},
  agent: Partial<TextExecutionInput["agent"]> = {},
): TextExecutionInput {
  return {
    agent: {
      connection: {
        isActive: true,
        id: "c1",
        name: "c",
        provider: "openai",
        hasApiKey: true,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: null,
        cliAccountLabel: null,
        updatedAt: "now",
      },
      model: "models/m 1",
      reasoningEffort: null,
      ...agent,
    },
    userId: "u1",
    prompt: "hello",
    ...overrides,
  };
}

const imageAsset: AgentTicketAssetContent = {
  parameter: "p",
  ticketId: "t",
  ticketKey: "K-1",
  asset: { source: "ticket", id: "a", link: "/a" },
  fileName: "f.png",
  content: { type: "image", mimeType: "image/png", base64: "QQ==" },
};
const textAsset: AgentTicketAssetContent = {
  ...imageAsset,
  content: { type: "text", text: "body" },
};

function body(
  request: ReturnType<typeof createTextProviderRequest>,
): Record<string, unknown> {
  return { ...request.body };
}

describe("createTextProviderRequest", () => {
  it("builds a plain Google request without optional parts", () => {
    const request = createTextProviderRequest("google_ai_studio", input());
    expect(request.path).toBe("/models/m%201:generateContent");
    expect(body(request)).toEqual({
      contents: [{ parts: [{ text: "hello" }] }],
      generationConfig: { maxOutputTokens: 16_384 },
    });
  });

  it("adds Google instructions, search, thinking level and assets", () => {
    const request = createTextProviderRequest(
      "google_ai_studio",
      input(
        { instructions: "sys", webSearch: true },
        { reasoningEffort: "low" },
      ),
      [textAsset],
    );
    expect(body(request)).toMatchObject({
      systemInstruction: { parts: [{ text: "sys" }] },
      tools: [{ google_search: {} }],
      generationConfig: { thinkingConfig: { thinkingLevel: "LOW" } },
    });
  });
});

describe("createTextProviderRequest for other providers", () => {
  it("builds Anthropic requests with and without optional parts", () => {
    const plain = createTextProviderRequest("anthropic", input());
    expect(plain.path).toBe("/messages");
    expect(body(plain).messages).toEqual([{ role: "user", content: "hello" }]);
    const full = createTextProviderRequest(
      "anthropic",
      input(
        { instructions: "sys", webSearch: true },
        { reasoningEffort: "high" },
      ),
      [textAsset],
    );
    expect(body(full)).toMatchObject({
      system: "sys",
      tools: [{ name: "web_search" }],
      output_config: { effort: "high" },
    });
    expect(JSON.stringify(body(full).messages)).toContain("body");
  });

  it("uses the Responses API for OpenAI search", () => {
    const plain = createTextProviderRequest(
      "openai",
      input({ webSearch: true }),
    );
    expect(plain.path).toBe("/responses");
    expect(body(plain).input).toBe("hello");
    expect(body(plain)).not.toHaveProperty("instructions");
    const full = createTextProviderRequest(
      "openai",
      input(
        { instructions: "sys", webSearch: true },
        { reasoningEffort: "low" },
      ),
      [textAsset],
    );
    expect(body(full)).toMatchObject({
      instructions: "sys",
      reasoning: { effort: "low" },
    });
    expect(JSON.stringify(body(full).input)).toContain("input_text");
  });

  it("builds OpenAI chat completions", () => {
    const plain = createTextProviderRequest("openai", input());
    expect(plain.path).toBe("/chat/completions");
    expect(body(plain)).toMatchObject({
      messages: [{ role: "user", content: "hello" }],
      max_completion_tokens: 16_384,
      store: false,
    });
    const full = createTextProviderRequest(
      "openai",
      input({ instructions: "sys" }, { reasoningEffort: "low" }),
      [textAsset],
    );
    expect(body(full)).toMatchObject({ reasoning_effort: "low" });
    expect(body(full).messages).toHaveLength(2);
  });

  it("builds OpenRouter completions with fallbacks off and optional search", () => {
    const plain = createTextProviderRequest("openrouter", input());
    expect(body(plain)).toMatchObject({
      max_tokens: 16_384,
      provider: { allow_fallbacks: false },
    });
    expect(body(plain)).not.toHaveProperty("plugins");
    const full = createTextProviderRequest(
      "openrouter",
      input({ webSearch: true }, { reasoningEffort: "low" }),
    );
    expect(body(full)).toMatchObject({
      plugins: [{ id: "web" }],
      reasoning: { effort: "low" },
    });
  });

  it("replaces images by a file note for models without image support", () => {
    const request = createTextProviderRequest(
      "anthropic",
      input({}, { supportsImages: false }),
      [imageAsset, textAsset],
    );
    const text = JSON.stringify(body(request).messages);
    expect(text).toContain("model-image-capability-unavailable");
    expect(text).not.toContain("base64");
  });

  it("keeps images for models that support them", () => {
    const request = createTextProviderRequest(
      "anthropic",
      input({}, { supportsImages: true }),
      [imageAsset],
    );
    expect(JSON.stringify(body(request).messages)).toContain("QQ==");
  });

  it("defaults to no assets", () => {
    expect(createTextProviderRequest("openrouter", input()).path).toBe(
      "/chat/completions",
    );
  });
});

function invalid(
  provider: Parameters<typeof readTextProviderResponse>[0],
  payload: unknown,
  webSearch = false,
): void {
  expect(() =>
    readTextProviderResponse(provider, payload, { webSearch }),
  ).toThrow(AgentExecutionError);
}

describe("readTextProviderResponse for chat completions", () => {
  const choice = (message: unknown, finish = "stop"): unknown => ({
    choices: [{ finish_reason: finish, message }],
  });

  it("returns the completed message", () => {
    expect(
      readTextProviderResponse("openrouter", choice({ content: "hi" })),
    ).toBe("hi");
  });

  it("rejects truncation, tool calls, refusals and missing choices", () => {
    invalid("openai", choice({ content: "x" }, "length"));
    invalid("openai", choice({ content: 1 }));
    invalid("openai", choice({ content: "x", tool_calls: [] }));
    invalid("openai", choice({ content: "x", refusal: "no" }));
    invalid("openai", {});
    invalid("openai", { choices: [] });
  });
});

describe("readTextProviderResponse for Google", () => {
  const candidate = (parts: unknown, finishReason = "STOP"): unknown => ({
    candidates: [{ finishReason, content: { parts } }],
  });

  it("joins the text parts", () => {
    expect(
      readTextProviderResponse(
        "google_ai_studio",
        candidate([{ text: "a" }, { text: "b" }]),
      ),
    ).toBe("ab");
  });

  it("rejects truncation, thoughts, non-text parts and missing candidates", () => {
    invalid("google_ai_studio", candidate([{ text: "a" }], "MAX_TOKENS"));
    invalid("google_ai_studio", candidate([{ text: "a", thought: true }]));
    invalid("google_ai_studio", candidate([{ data: 1 }]));
    invalid("google_ai_studio", candidate("nope"));
    invalid("google_ai_studio", {});
  });
});

describe("readTextProviderResponse for Anthropic", () => {
  const answer = (content: unknown, stop = "end_turn"): unknown => ({
    stop_reason: stop,
    content,
  });

  it("joins text blocks", () => {
    expect(
      readTextProviderResponse(
        "anthropic",
        answer([{ text: "a" }, { text: "b" }]),
      ),
    ).toBe("ab");
  });

  it("skips search blocks when search was requested", () => {
    expect(
      readTextProviderResponse(
        "anthropic",
        answer([
          { type: "server_tool_use" },
          { type: "web_search_tool_result" },
          { type: "text", text: "a" },
        ]),
        { webSearch: true },
      ),
    ).toBe("a");
  });

  it("rejects truncation and unknown blocks", () => {
    invalid("anthropic", answer([{ text: "a" }], "max_tokens"));
    invalid("anthropic", answer("nope"), true);
    invalid("anthropic", answer([{ type: "tool_use" }]), true);
  });
});

describe("readTextProviderResponse for OpenAI search", () => {
  const completed = (output: unknown, status = "completed"): unknown => ({
    status,
    output,
  });

  it("joins output text and skips reasoning and search items", () => {
    expect(
      readTextProviderResponse(
        "openai",
        completed([
          { type: "reasoning" },
          { type: "web_search_call" },
          {
            type: "message",
            content: [{ type: "output_text", text: "a" }],
          },
        ]),
        { webSearch: true },
      ),
    ).toBe("a");
  });

  it("rejects unfinished, refused and unknown output", () => {
    invalid("openai", completed([], "incomplete"), true);
    invalid("openai", { status: "completed" }, true);
    invalid("openai", completed([{ type: "function_call" }]), true);
    invalid("openai", completed([{ type: "message", content: "x" }]), true);
    invalid(
      "openai",
      completed([{ type: "message", content: [{ type: "refusal" }] }]),
      true,
    );
    invalid(
      "openai",
      completed([{ type: "message", content: [{ type: "output_text" }] }]),
      true,
    );
  });
});
