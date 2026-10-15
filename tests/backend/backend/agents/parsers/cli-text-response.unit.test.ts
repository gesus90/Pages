import { describe, expect, it } from "vitest";

import { readCliTextResponse } from "@/backend/agents/cli/CliTextResponse";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { jsonLines } from "./cli-output-lines";

import type { TextAssistantErrorCode } from "@/backend/error/TextAssistantErrors";
import type { CliProviderId } from "@/definition/AgentConnection";

function expectFailure(
  provider: CliProviderId,
  output: string,
  code: TextAssistantErrorCode,
  options: { readonly webSearch?: boolean } = {},
): void {
  let thrown: unknown;
  try {
    readCliTextResponse(provider, output, options);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TextAssistantError);
  expect(thrown).toMatchObject({ code });
}

const CLAUDE_SUCCESS = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Translated text",
};

describe("readCliTextResponse for Claude Code", () => {
  it("returns the result of a successful turn", () => {
    expect(
      readCliTextResponse("claude_code", JSON.stringify(CLAUDE_SUCCESS)),
    ).toBe("Translated text");
  });

  it.each([
    ["an error flag", { ...CLAUDE_SUCCESS, is_error: true }],
    ["another subtype", { ...CLAUDE_SUCCESS, subtype: "error_max_turns" }],
    ["a non-string result", { ...CLAUDE_SUCCESS, result: { text: "x" } }],
    [
      "a missing result",
      { type: "result", subtype: "success", is_error: false },
    ],
  ])("rejects %s", (_, payload) => {
    expectFailure("claude_code", JSON.stringify(payload), "invalidOutput");
  });

  it.each(["", "not json", '{"type":"result"'])(
    "rejects unparseable output %j",
    (output) => {
      expectFailure("claude_code", output, "invalidOutput");
    },
  );
});

describe("readCliTextResponse for Codex CLI", () => {
  const message = {
    type: "item.completed",
    item: { type: "agent_message", text: "Final answer" },
  };
  const done = { type: "turn.completed", usage: {} };

  it("returns the last completed agent message of a completed turn", () => {
    const output = jsonLines([
      { type: "thread.started" },
      { type: "item.started", item: { type: "reasoning" } },
      { type: "item.completed", item: { type: "reasoning", text: "hmm" } },
      {
        type: "item.completed",
        item: { type: "agent_message", text: "Draft" },
      },
      message,
      done,
    ]);
    expect(readCliTextResponse("codex_cli", output)).toBe("Final answer");
  });

  it("rejects a turn that never completed", () => {
    expectFailure("codex_cli", jsonLines([message]), "invalidOutput");
  });

  it("rejects a completed turn without an agent message", () => {
    expectFailure("codex_cli", jsonLines([done]), "invalidOutput");
  });

  it("rejects an empty agent message", () => {
    const empty = {
      type: "item.completed",
      item: { type: "agent_message", text: "" },
    };
    expectFailure("codex_cli", jsonLines([empty, done]), "invalidOutput");
  });

  it.each(["turn.failed", "error"])(
    "reports a %s event as a provider failure",
    (type) => {
      expectFailure(
        "codex_cli",
        jsonLines([message, { type, message: "boom" }]),
        "providerFailed",
      );
    },
  );

  it.each(["command_execution", "file_change", "mcp_tool_call"])(
    "rejects a %s item as no text answer",
    (itemType) => {
      const tool = { type: "item.started", item: { type: itemType } };
      expectFailure(
        "codex_cli",
        jsonLines([tool, message, done]),
        "invalidOutput",
      );
    },
  );

  it("allows a web search only where the chat permitted it", () => {
    const search = { type: "item.completed", item: { type: "web_search" } };
    const output = jsonLines([search, message, done]);
    expect(readCliTextResponse("codex_cli", output, { webSearch: true })).toBe(
      "Final answer",
    );
    expectFailure("codex_cli", output, "invalidOutput");
    expectFailure("codex_cli", output, "invalidOutput", { webSearch: false });
  });

  it("rejects a diagnostic line that is not JSON", () => {
    const output = `WARN: slow\n${jsonLines([message, done])}`;
    expectFailure("codex_cli", output, "invalidOutput");
  });
});

describe("readCliTextResponse for OpenCode", () => {
  const stop = { type: "step_finish", part: { reason: "stop" } };

  it("joins the text parts of the final step", () => {
    const output = jsonLines([
      { type: "step_start" },
      { type: "text", part: { text: "Hello, " } },
      { type: "text", part: { text: "world" } },
      stop,
    ]);
    expect(readCliTextResponse("opencode", output)).toBe("Hello, world");
  });

  it("starts the answer afresh at each step", () => {
    const output = jsonLines([
      { type: "step_start" },
      { type: "text", part: { text: "thinking aloud" } },
      { type: "step_finish", part: { reason: "other" } },
      { type: "step_start" },
      { type: "text", part: { text: "final" } },
      stop,
    ]);
    expect(readCliTextResponse("opencode", output)).toBe("final");
  });

  it("rejects an answer whose last step did not stop", () => {
    const output = jsonLines([
      { type: "text", part: { text: "partial" } },
      { type: "step_finish", part: { reason: "length" } },
    ]);
    expectFailure("opencode", output, "invalidOutput");
  });

  it("rejects whitespace-only text", () => {
    const output = jsonLines([{ type: "text", part: { text: " \n" } }, stop]);
    expectFailure("opencode", output, "invalidOutput");
  });

  it("rejects a tool use even when text follows", () => {
    const output = jsonLines([
      { type: "tool_use", part: { tool: "bash" } },
      { type: "text", part: { text: "done" } },
      stop,
    ]);
    expectFailure("opencode", output, "invalidOutput");
  });

  it("reports an error event as a provider failure", () => {
    const output = jsonLines([
      { type: "text", part: { text: "partial" } },
      { type: "error", error: { name: "APIError" } },
    ]);
    expectFailure("opencode", output, "providerFailed");
  });

  it("rejects truncated output", () => {
    expectFailure("opencode", '{"type":"text","part":{"te', "invalidOutput");
  });
});
