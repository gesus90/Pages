import { describe, expect, it } from "vitest";

import { readClaudeTest } from "@/backend/agents/cli/CliResultParser";

const SUCCESS = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "OK",
  total_cost_usd: 0.0012,
  usage: { input_tokens: 5, output_tokens: 2 },
  modelUsage: { "claude-synthetic-1": { inputTokens: 5 } },
};

describe("readClaudeTest", () => {
  it("accepts the success result and reports model, tokens and cost", () => {
    expect(readClaudeTest(`${JSON.stringify(SUCCESS)}\n`)).toEqual({
      ok: true,
      detail: {
        model: "claude-synthetic-1",
        inputTokens: 5,
        outputTokens: 2,
        costUsd: 0.0012,
      },
    });
  });

  it("omits a model name that is not a plain identifier", () => {
    const output = JSON.stringify({
      ...SUCCESS,
      modelUsage: { "bad model name!": {} },
    });
    expect(readClaudeTest(output)).toEqual({
      ok: true,
      detail: { inputTokens: 5, outputTokens: 2, costUsd: 0.0012 },
    });
  });

  it("succeeds with an empty detail when usage data is missing", () => {
    const output = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
    });
    expect(readClaudeTest(output)).toEqual({ ok: true, detail: {} });
  });

  it("rejects is_error true even though the process may exit with zero", () => {
    const output = JSON.stringify({
      ...SUCCESS,
      is_error: true,
      result: "authentication_error: invalid token",
    });
    expect(readClaudeTest(output)).toEqual({
      ok: false,
      errorCode: "cli_auth_failed",
      detail: {},
    });
  });

  it("rejects a non-success subtype", () => {
    const output = JSON.stringify({ ...SUCCESS, subtype: "error_max_turns" });
    expect(readClaudeTest(output)).toEqual({
      ok: false,
      errorCode: "cli_check_failed",
      detail: {},
    });
  });

  it("requires an explicit is_error false", () => {
    const withoutFlag = Object.fromEntries(
      Object.entries(SUCCESS).filter(([key]) => key !== "is_error"),
    );
    expect(readClaudeTest(JSON.stringify(withoutFlag))).toMatchObject({
      ok: false,
      errorCode: "cli_check_failed",
    });
  });

  it("classifies provider throttling reported inside the result", () => {
    const output = JSON.stringify({
      ...SUCCESS,
      is_error: true,
      result: "API Error: 429 rate_limit_error",
    });
    expect(readClaudeTest(output)).toMatchObject({
      errorCode: "provider_rate_limited",
    });
  });

  it.each([
    ["empty output", ""],
    ["truncated JSON", '{"type":"result","subtype":"succ'],
    ["plain text", "Claude Code v9 starting"],
    [
      "two concatenated objects",
      `${JSON.stringify(SUCCESS)}\n${JSON.stringify(SUCCESS)}`,
    ],
  ])("reports %s as unexpected output", (_, output) => {
    expect(readClaudeTest(output)).toEqual({
      ok: false,
      errorCode: "cli_unexpected_output",
      detail: {},
    });
  });

  it("does not treat a JSON array as a success", () => {
    expect(readClaudeTest("[]")).toMatchObject({
      ok: false,
      errorCode: "cli_check_failed",
    });
  });
});
