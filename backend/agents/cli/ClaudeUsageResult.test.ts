import { expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import { isClaudeUsageAnswer, readClaudeUsage } from "./ClaudeUsageResult";

function answer(response: unknown): string {
  return JSON.stringify({
    type: "control_response",
    response: { request_id: "pages-usage", ...Object.assign({}, response) },
  });
}

function success(usage: unknown): string {
  return answer({ subtype: "success", response: usage });
}

it("recognizes only the control response of the usage request", () => {
  expect(isClaudeUsageAnswer(answer({}))).toBe(true);
  expect(isClaudeUsageAnswer("not json")).toBe(false);
  expect(isClaudeUsageAnswer("[]")).toBe(false);
  expect(
    isClaudeUsageAnswer(JSON.stringify({ type: "control_response" })),
  ).toBe(false);
  expect(
    isClaudeUsageAnswer(
      JSON.stringify({
        type: "result",
        response: { request_id: "pages-usage" },
      }),
    ),
  ).toBe(false);
});

it("rejects output without a successful answer", () => {
  const unexpected = new AgentError("cli_unexpected_output");
  expect(() => readClaudeUsage("")).toThrow(unexpected);
  expect(() => readClaudeUsage("noise\n\n{}")).toThrow(unexpected);
  expect(() => readClaudeUsage(answer({ subtype: "error" }))).toThrow(
    unexpected,
  );
});

it("reports a missing rate limit object as no windows", () => {
  expect(
    readClaudeUsage(success({ subscription_type: "max", rate_limits: null })),
  ).toEqual({ plan: "max", windows: null });
  expect(readClaudeUsage(success({ rate_limits: "x" }))).toEqual({
    plan: null,
    windows: null,
  });
  expect(readClaudeUsage(success({ rate_limits: [] }))).toEqual({
    plan: null,
    windows: null,
  });
});

it("refuses a stored copy without limit rows", () => {
  expect(() =>
    readClaudeUsage(success({ rate_limits: { five_hour: {} } })),
  ).toThrow(new AgentError("claude_usage_stale"));
});

it("reads, clamps and rounds the reported windows", () => {
  const reading = readClaudeUsage(
    `noise\n${success({
      subscription_type: "pro",
      rate_limits: {
        limits: [],
        five_hour: {
          utilization: 12.3456,
          resets_at: "2030-01-01T00:00:00Z",
        },
        seven_day: { utilization: 250, resets_at: "2030-01-02T00:00:00Z" },
      },
    })}`,
  );
  expect(reading).toEqual({
    plan: "pro",
    windows: [
      {
        kind: "five_hour",
        usedPercentage: 12.35,
        resetsAt: "2030-01-01T00:00:00.000Z",
      },
      {
        kind: "seven_day",
        usedPercentage: 100,
        resetsAt: "2030-01-02T00:00:00.000Z",
      },
    ],
  });
  expect(
    readClaudeUsage(
      success({
        rate_limits: {
          limits: [],
          five_hour: { utilization: -5, resets_at: "2030-01-01T00:00:00Z" },
        },
      }),
    ).windows?.[0].usedPercentage,
  ).toBe(0);
});

it("omits windows without a finite figure or a reset time", () => {
  const reading = readClaudeUsage(
    success({
      rate_limits: {
        limits: [],
        five_hour: { utilization: "x", resets_at: "2030-01-01T00:00:00Z" },
        seven_day: { utilization: 5, resets_at: "tomorrow" },
      },
    }),
  );
  expect(reading.windows).toEqual([]);
  expect(
    readClaudeUsage(
      success({
        rate_limits: {
          limits: [],
          five_hour: { utilization: Infinity, resets_at: 1_900_000_000 },
        },
      }),
    ).windows,
  ).toEqual([]);
});
