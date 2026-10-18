import { describe, expect, it } from "vitest";

import { readTextProviderResponse } from "@/backend/agents/providers/TextProviderPayload";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

import type { ApiProviderId } from "@/definition/AgentConnection";

function expectInvalid(
  provider: ApiProviderId,
  payload: unknown,
  options: { readonly webSearch?: boolean } = {},
): void {
  let thrown: unknown;
  try {
    readTextProviderResponse(provider, payload, options);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AgentExecutionError);
  expect(thrown).toMatchObject({ code: "invalidOutput" });
}

function completion(
  message: Record<string, unknown>,
  finishReason = "stop",
): unknown {
  return { choices: [{ finish_reason: finishReason, message }] };
}

describe("readTextProviderResponse for chat completions", () => {
  it.each(["openai", "openrouter", "zai"] as const)(
    "returns the content of a stopped %s answer",
    (provider) => {
      expect(
        readTextProviderResponse(
          provider,
          completion({ role: "assistant", content: "Bonjour" }),
        ),
      ).toBe("Bonjour");
    },
  );

  it.each([
    ["a truncated answer", completion({ content: "part" }, "length")],
    ["a content filter stop", completion({ content: "" }, "content_filter")],
    [
      "a tool call request",
      completion({ content: null, tool_calls: [{}] }, "tool_calls"),
    ],
    ["tool calls next to text", completion({ content: "x", tool_calls: [{}] })],
    ["a refusal", completion({ content: "x", refusal: "I cannot help" })],
    ["content that is not text", completion({ content: ["a"] })],
    ["null content", completion({ content: null })],
    ["no choices", { choices: [] }],
    ["no choices list", {}],
    ["a non-object payload", "text"],
    ["a null payload", null],
  ])("rejects %s", (_, payload) => {
    expectInvalid("openai", payload);
  });

  it("reads only the first choice", () => {
    const payload = {
      choices: [
        { finish_reason: "stop", message: { content: "first" } },
        { finish_reason: "stop", message: { content: "second" } },
      ],
    };
    expect(readTextProviderResponse("openrouter", payload)).toBe("first");
  });
});

describe("readTextProviderResponse for Anthropic", () => {
  function answer(content: unknown, stopReason = "end_turn"): unknown {
    return { stop_reason: stopReason, content };
  }

  it("joins the text blocks of a finished turn", () => {
    const payload = answer([
      { type: "text", text: "Hello, " },
      { type: "text", text: "world" },
    ]);
    expect(readTextProviderResponse("anthropic", payload)).toBe("Hello, world");
  });

  it.each([
    ["max_tokens", [{ type: "text", text: "cut" }]],
    ["tool_use", [{ type: "tool_use", id: "t" }]],
    ["refusal", [{ type: "text", text: "no" }]],
  ])("rejects stop reason %s", (stopReason, content) => {
    expectInvalid("anthropic", answer(content, stopReason));
  });

  it.each([
    ["a thinking block", [{ type: "thinking", thinking: "hmm" }]],
    ["a search block without search enabled", [{ type: "server_tool_use" }]],
    ["content that is not a list", "text"],
    ["a text block without text", [{ type: "text" }]],
  ])("rejects %s", (_, content) => {
    expectInvalid("anthropic", answer(content));
  });

  it("skips server-side search blocks when search was requested", () => {
    const payload = answer([
      { type: "text", text: "Let me look. " },
      { type: "server_tool_use", name: "web_search" },
      { type: "web_search_tool_result", content: [] },
      { type: "text", text: "Found it." },
    ]);
    expect(
      readTextProviderResponse("anthropic", payload, { webSearch: true }),
    ).toBe("Let me look. Found it.");
  });

  it.each([
    ["a client tool use", [{ type: "tool_use", id: "t" }]],
    ["a thinking block", [{ type: "thinking", thinking: "hmm" }]],
  ])("still rejects %s when search was requested", (_, content) => {
    expectInvalid("anthropic", answer(content), { webSearch: true });
  });

  it("requires a finished turn also when search was requested", () => {
    expectInvalid(
      "anthropic",
      answer([{ type: "text", text: "x" }], "pause_turn"),
      { webSearch: true },
    );
  });
});

describe("readTextProviderResponse for Google AI Studio", () => {
  function candidate(parts: unknown, finishReason = "STOP"): unknown {
    return { candidates: [{ finishReason, content: { parts } }] };
  }

  it("joins the parts of a stopped candidate", () => {
    const payload = candidate([{ text: "Guten " }, { text: "Tag" }]);
    expect(readTextProviderResponse("google_ai_studio", payload)).toBe(
      "Guten Tag",
    );
  });

  it.each([
    ["a token limit stop", candidate([{ text: "cut" }], "MAX_TOKENS")],
    ["a safety stop", candidate([{ text: "x" }], "SAFETY")],
    [
      "a thought part",
      candidate([{ text: "hmm", thought: true }, { text: "x" }]),
    ],
    ["a function call part", candidate([{ functionCall: { name: "f" } }])],
    ["parts that are not a list", candidate("text")],
    ["no candidates", { candidates: [] }],
    ["a blocked prompt", { promptFeedback: { blockReason: "SAFETY" } }],
  ])("rejects %s", (_, payload) => {
    expectInvalid("google_ai_studio", payload);
  });
});

describe("readTextProviderResponse for OpenAI search responses", () => {
  const options = { webSearch: true };

  function response(output: unknown, status = "completed"): unknown {
    return { status, output };
  }

  it("collects output text and skips reasoning and search calls", () => {
    const payload = response([
      { type: "reasoning", summary: [] },
      { type: "web_search_call", status: "completed" },
      {
        type: "message",
        content: [
          { type: "output_text", text: "Result: ", annotations: [] },
          { type: "output_text", text: "42" },
        ],
      },
    ]);
    expect(readTextProviderResponse("openai", payload, options)).toBe(
      "Result: 42",
    );
  });

  it.each([
    ["an incomplete response", response([], "incomplete")],
    ["a failed response", response([], "failed")],
    ["a missing output list", { status: "completed" }],
    ["a function call item", response([{ type: "function_call" }])],
    [
      "a refusal part",
      response([
        { type: "message", content: [{ type: "refusal", refusal: "no" }] },
      ]),
    ],
    [
      "message content that is not a list",
      response([{ type: "message", content: "x" }]),
    ],
    [
      "an output part without text",
      response([{ type: "message", content: [{ type: "output_text" }] }]),
    ],
  ])("rejects %s", (_, payload) => {
    expectInvalid("openai", payload, options);
  });

  it("reads a normal completion when search was not requested", () => {
    const payload = completion({ content: "plain" });
    expect(
      readTextProviderResponse("openai", payload, { webSearch: false }),
    ).toBe("plain");
  });
});
