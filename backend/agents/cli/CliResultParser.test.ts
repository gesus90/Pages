import { expect, it, vi } from "vitest";

import {
  classifyCliFailure,
  readClaudeTest,
  readCodexTest,
  readOpenCodeTest,
} from "./CliResultParser";

const logging = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logging);

const unexpected = {
  ok: false,
  errorCode: "cli_unexpected_output",
  detail: {},
};

function lines(...events: readonly unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n\n");
}

it.each([
  [{ message: "Not logged in" }, "cli_auth_failed"],
  [{ status: 401 }, "cli_auth_failed"],
  [{ message: "usage limit reached" }, "provider_quota_exhausted"],
  [{ code: "insufficient_quota" }, "provider_quota_exhausted"],
  [{ status: 429 }, "provider_rate_limited"],
  [{ message: "rate_limit" }, "provider_rate_limited"],
  [{ message: "something else" }, "cli_check_failed"],
])("classifies %j as %s", (payload, code) => {
  expect(classifyCliFailure(payload)).toBe(code);
});

it("accepts a completed Codex turn with usage", () => {
  const output = lines(
    { type: "turn.started" },
    { type: "turn.completed", usage: { input_tokens: 3, output_tokens: 4 } },
  );
  expect(readCodexTest(output)).toEqual({
    ok: true,
    detail: { inputTokens: 3, outputTokens: 4 },
  });
});

it("rejects a Codex output without completion", () => {
  expect(readCodexTest(lines({ type: "turn.started" }))).toEqual({
    ok: false,
    errorCode: "cli_check_failed",
    detail: {},
  });
});

it.each(["turn.failed", "error"])("classifies a Codex %s event", (type) => {
  const output = lines(
    { type: "turn.completed", usage: {} },
    { type, message: "unauthorized" },
  );
  expect(readCodexTest(output)).toEqual({
    ok: false,
    errorCode: "cli_auth_failed",
    detail: {},
  });
});

it("rejects unparsable Codex output and logs it", () => {
  expect(readCodexTest("not json")).toEqual(unexpected);
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "CliResultParser",
    expect.any(SyntaxError),
  );
});

it("accepts a successful Claude result with the first model", () => {
  const output = JSON.stringify({
    is_error: false,
    subtype: "success",
    usage: { input_tokens: 1, output_tokens: 2 },
    modelUsage: { "claude-synthetic": {}, other: {} },
    total_cost_usd: 0.5,
  });
  expect(readClaudeTest(output)).toEqual({
    ok: true,
    detail: {
      model: "claude-synthetic",
      inputTokens: 1,
      outputTokens: 2,
      costUsd: 0.5,
    },
  });
});

it("accepts a successful Claude result without usage fields", () => {
  const output = JSON.stringify({ is_error: false, subtype: "success" });
  expect(readClaudeTest(output)).toEqual({ ok: true, detail: {} });
});

it.each([
  [{ is_error: true, subtype: "success", result: "rate limit" }],
  [{ is_error: false, subtype: "error_max_turns" }],
])("rejects the Claude result %j", (result) => {
  const outcome = readClaudeTest(JSON.stringify(result));
  expect(outcome.ok).toBe(false);
});

it("classifies a failed Claude result", () => {
  const outcome = readClaudeTest(
    JSON.stringify({ is_error: true, subtype: "error", result: "401" }),
  );
  expect(outcome).toMatchObject({ errorCode: "cli_auth_failed" });
});

it("rejects unparsable Claude output", () => {
  expect(readClaudeTest("{")).toEqual(unexpected);
});

it("accepts a finished OpenCode step with text", () => {
  const output = lines(
    { type: "text", part: { text: "  " } },
    { type: "text", part: { text: "hello" } },
    { type: "text", part: { text: "   " } },
    { type: "text", part: { text: 5 } },
    { type: "step_finish", part: { reason: "tool-calls" } },
    {
      type: "step_finish",
      part: { reason: "stop", tokens: { input: 7, output: 8 }, cost: 0.1 },
    },
  );
  expect(readOpenCodeTest(output)).toEqual({
    ok: true,
    detail: { inputTokens: 7, outputTokens: 8, costUsd: 0.1 },
  });
});

it("accepts a finished OpenCode step without token data", () => {
  const output = lines(
    { type: "text", part: { text: "hello" } },
    { type: "step_finish", part: { reason: "stop" } },
  );
  expect(readOpenCodeTest(output)).toEqual({ ok: true, detail: {} });
});

it("rejects an OpenCode step without text or without a stop", () => {
  const noText = lines({ type: "step_finish", part: { reason: "stop" } });
  const noStop = lines({ type: "text", part: { text: "hello" } });
  expect(readOpenCodeTest(noText)).toMatchObject({
    errorCode: "cli_check_failed",
  });
  expect(readOpenCodeTest(noStop)).toMatchObject({
    errorCode: "cli_check_failed",
  });
});

it("uses the specific OpenCode failure classification", () => {
  const output = lines(
    { type: "text", part: { text: "hello" } },
    { type: "step_finish", part: { reason: "stop" } },
    { type: "error", error: { name: "RateLimit 429" } },
  );
  expect(readOpenCodeTest(output)).toMatchObject({
    errorCode: "provider_rate_limited",
  });
});

it("falls back to the generic classification for an unspecific error", () => {
  const output = lines({ type: "error", error: { name: "Strange" } });
  expect(readOpenCodeTest(output)).toMatchObject({
    errorCode: "cli_check_failed",
  });
});

it("rejects unparsable OpenCode output", () => {
  expect(readOpenCodeTest("nope")).toEqual(unexpected);
});
