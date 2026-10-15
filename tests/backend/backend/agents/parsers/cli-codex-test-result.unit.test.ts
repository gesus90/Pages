import { describe, expect, it } from "vitest";

import { readCodexTest } from "@/backend/agents/cli/CliResultParser";

import { jsonLines } from "./cli-output-lines";

const COMPLETED = {
  type: "turn.completed",
  usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 3 },
};

describe("readCodexTest", () => {
  it("accepts a completed turn and keeps only the token counts", () => {
    const output = jsonLines([
      { type: "thread.started", thread_id: "synthetic-thread" },
      { type: "turn.started" },
      { type: "item.completed", item: { type: "agent_message", text: "OK" } },
      COMPLETED,
    ]);
    expect(readCodexTest(output)).toEqual({
      ok: true,
      detail: { inputTokens: 12, outputTokens: 3 },
    });
  });

  it("tolerates blank lines and Windows line endings", () => {
    const output = `${JSON.stringify({ type: "turn.started" })}\r\n\r\n${JSON.stringify(COMPLETED)}\r\n`;
    expect(readCodexTest(output)).toMatchObject({ ok: true });
  });

  it("treats a completed turn without usage as proof with no counts", () => {
    expect(readCodexTest(jsonLines([{ type: "turn.completed" }]))).toEqual({
      ok: true,
      detail: {},
    });
  });

  it("drops token counts that are negative or not numbers", () => {
    const output = jsonLines([
      {
        type: "turn.completed",
        usage: { input_tokens: -1, output_tokens: "3" },
      },
    ]);
    expect(readCodexTest(output)).toEqual({ ok: true, detail: {} });
  });

  it("does not count an exit without a completed turn as success", () => {
    const output = jsonLines([{ type: "turn.started" }]);
    expect(readCodexTest(output)).toEqual({
      ok: false,
      errorCode: "cli_check_failed",
      detail: {},
    });
  });

  it("reports empty output as a failed check, not as unexpected output", () => {
    expect(readCodexTest("")).toMatchObject({
      ok: false,
      errorCode: "cli_check_failed",
    });
  });

  it.each([
    ["turn.failed", "provider_rate_limited", "429 Too Many Requests"],
    ["error", "cli_auth_failed", "Not logged in"],
    ["turn.failed", "provider_quota_exhausted", "usage limit reached"],
    ["error", "cli_check_failed", "model exploded"],
  ])("classifies a %s event as %s", (type, errorCode, message) => {
    const output = jsonLines([{ type: "turn.started" }, { type, message }]);
    expect(readCodexTest(output)).toEqual({
      ok: false,
      errorCode,
      detail: {},
    });
  });

  it("fails when an error follows the completed turn", () => {
    const output = jsonLines([
      COMPLETED,
      { type: "error", message: "rate limit hit afterwards" },
    ]);
    expect(readCodexTest(output)).toMatchObject({
      ok: false,
      errorCode: "provider_rate_limited",
    });
  });

  it.each([
    ["truncated JSON", `${JSON.stringify(COMPLETED).slice(0, 20)}`],
    ["a plain log line", "WARN: something is slow"],
    ["a line with ANSI colour codes", `\u001b[32m${JSON.stringify(COMPLETED)}`],
  ])("reports %s as unexpected output", (_, line) => {
    const output = `${jsonLines([{ type: "turn.started" }])}${line}\n`;
    expect(readCodexTest(output)).toEqual({
      ok: false,
      errorCode: "cli_unexpected_output",
      detail: {},
    });
  });

  it("ignores lines that are valid JSON but not objects", () => {
    const output = `42\n"text"\n[1,2]\nnull\n${JSON.stringify(COMPLETED)}\n`;
    expect(readCodexTest(output)).toMatchObject({ ok: true });
  });
});
