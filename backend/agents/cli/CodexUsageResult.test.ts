import { expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import { isCodexUsageAnswer, readCodexUsage } from "./CodexUsageResult";

function answer(result: unknown): string {
  return JSON.stringify({ id: 2, result });
}

function failure(message: unknown): string {
  return JSON.stringify({ id: 2, error: { message } });
}

it("recognizes only a response to the usage request", () => {
  expect(isCodexUsageAnswer(answer({}))).toBe(true);
  expect(isCodexUsageAnswer(failure("x"))).toBe(true);
  expect(isCodexUsageAnswer("not json")).toBe(false);
  expect(isCodexUsageAnswer(JSON.stringify({ id: 2 }))).toBe(false);
  expect(isCodexUsageAnswer(JSON.stringify({ id: 1, result: {} }))).toBe(false);
  expect(
    isCodexUsageAnswer(JSON.stringify({ id: 2, method: "x", result: {} })),
  ).toBe(false);
});

it("fails without an answer", () => {
  expect(() => readCodexUsage("noise\n\n")).toThrow(
    new AgentError("cli_unexpected_output"),
  );
});

it("turns the message of an error into a code without leaking the text", () => {
  expect(() => readCodexUsage(failure("Authentication required"))).toThrow(
    new AgentError("cli_not_logged_in"),
  );
  expect(() => readCodexUsage(failure("HTTP 401"))).toThrow(
    new AgentError("cli_auth_failed"),
  );
  expect(() => readCodexUsage(failure("other"))).toThrow(
    new AgentError("cli_check_failed"),
  );
  expect(() => readCodexUsage(failure(5))).toThrow(
    new AgentError("cli_check_failed"),
  );
});

it("prefers the general snapshot of the per-limit view", () => {
  const reading = readCodexUsage(
    answer({
      rateLimits: { limitId: "other" },
      rateLimitsByLimitId: {
        codex: {
          planType: "Plus",
          rateLimitReachedType: "primary",
          primary: {
            usedPercent: 42.4,
            windowDurationMins: 300,
            resetsAt: 1_900_000_000,
          },
          secondary: {
            usedPercent: 250,
            windowDurationMins: 1.5,
            resetsAt: "never",
          },
          other: {},
        },
      },
    }),
  );
  expect(reading).toEqual({
    plan: "plus",
    isLimitReached: true,
    windows: [
      {
        kind: "primary",
        usedPercent: 42,
        durationMinutes: 300,
        resetsAt: "2030-03-17T17:46:40.000Z",
      },
      {
        kind: "secondary",
        usedPercent: 100,
        durationMinutes: null,
        resetsAt: null,
      },
    ],
  });
});

it("falls back to a compatible single bucket of the general quota", () => {
  const named = readCodexUsage(
    answer({ rateLimits: { limitId: "codex", planType: "pro" } }),
  );
  expect(named).toEqual({ plan: "pro", windows: [], isLimitReached: false });
  expect(
    readCodexUsage(answer({ rateLimits: { limitId: null } })).plan,
  ).toBeNull();
  expect(readCodexUsage(answer({ rateLimits: {} })).windows).toEqual([]);
});

it("ignores snapshots of other limits and a limit-less answer", () => {
  const empty = { plan: null, windows: [], isLimitReached: false };
  expect(readCodexUsage(answer({ rateLimits: { limitId: "model" } }))).toEqual(
    empty,
  );
  expect(readCodexUsage(answer({ rateLimits: "x" }))).toEqual(empty);
  expect(
    readCodexUsage(answer({ rateLimits: {}, rateLimitsByLimitId: {} })),
  ).toEqual(empty);
  expect(
    readCodexUsage(
      answer({ rateLimitsByLimitId: [], rateLimits: { limitId: "codex" } }),
    ).plan,
  ).toBeNull();
});

it("marks a reached limit from the account statement or the snapshot", () => {
  expect(
    readCodexUsage(answer({ ordinaryUsageAllowed: false })).isLimitReached,
  ).toBe(true);
  expect(
    readCodexUsage(answer({ rateLimits: { rateLimitReachedType: "" } }))
      .isLimitReached,
  ).toBe(false);
  expect(
    readCodexUsage(answer({ rateLimits: { rateLimitReachedType: 1 } }))
      .isLimitReached,
  ).toBe(false);
});

it("drops windows without a finite used share", () => {
  const reading = readCodexUsage(
    answer({
      rateLimits: {
        primary: { usedPercent: "x" },
        secondary: { usedPercent: Infinity },
      },
    }),
  );
  expect(reading.windows).toEqual([]);
});
