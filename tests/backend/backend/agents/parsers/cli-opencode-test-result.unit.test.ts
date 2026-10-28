import { describe, expect, it } from "vitest";

import { readOpenCodeTest } from "@/backend/agents/cli/CliResultParser";

import { jsonLines } from "./cli-output-lines";

const FINISH = {
  type: "step_finish",
  part: {
    reason: "stop",
    cost: 0,
    tokens: { input: 10, output: 2, reasoning: 0 },
  },
};
const TEXT = { type: "text", part: { text: "OK" } };

describe("readOpenCodeTest", () => {
  it("accepts a finished step with text and keeps tokens and a zero cost", () => {
    const output = jsonLines([{ type: "step_start", part: {} }, TEXT, FINISH]);
    expect(readOpenCodeTest(output)).toEqual({
      ok: true,
      detail: { inputTokens: 10, outputTokens: 2, costUsd: 0 },
    });
  });

  it("rejects a finished step without any text", () => {
    expect(readOpenCodeTest(jsonLines([FINISH]))).toEqual({
      ok: false,
      errorCode: "cli_check_failed",
      detail: {},
    });
  });

  it("rejects whitespace-only text", () => {
    const blank = { type: "text", part: { text: "  \n " } };
    expect(readOpenCodeTest(jsonLines([blank, FINISH]))).toMatchObject({
      ok: false,
      errorCode: "cli_check_failed",
    });
  });

  it("ignores a text part whose text is not a string", () => {
    const malformed = { type: "text", part: { text: 7 } };
    expect(readOpenCodeTest(jsonLines([malformed, FINISH]))).toMatchObject({
      ok: false,
    });
  });

  it("requires the stop reason, so a tool-call step is no proof", () => {
    const toolStep = {
      type: "step_finish",
      part: { ...FINISH.part, reason: "tool-calls" },
    };
    expect(readOpenCodeTest(jsonLines([TEXT, toolStep]))).toMatchObject({
      ok: false,
      errorCode: "cli_check_failed",
    });
  });

  it("fails on an error event even when a step finished", () => {
    const output = jsonLines([
      TEXT,
      FINISH,
      { type: "error", error: { message: "429 rate limit" } },
    ]);
    expect(readOpenCodeTest(output)).toEqual({
      ok: false,
      errorCode: "provider_rate_limited",
      detail: {},
    });
  });

  it("reports unparseable output as unexpected", () => {
    const output = `${jsonLines([TEXT])}{"type":"step_fin`;
    expect(readOpenCodeTest(output)).toEqual({
      ok: false,
      errorCode: "cli_unexpected_output",
      detail: {},
    });
  });

  it("reports empty output as a failed check", () => {
    expect(readOpenCodeTest("\n\n")).toMatchObject({
      ok: false,
      errorCode: "cli_check_failed",
    });
  });
});

it("falls back to the CLI classification for an error OpenCode does not name", () => {
  const error = { type: "error", error: { message: "not logged in" } };

  expect(readOpenCodeTest(jsonLines([error, TEXT, FINISH]))).toEqual({
    ok: false,
    errorCode: "cli_auth_failed",
    detail: {},
  });
});
