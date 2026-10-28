import { afterEach, expect, it, vi } from "vitest";

import {
  acpProviderFailure,
  diagnosticProviderFailure,
  isPlanRetryCode,
} from "@/backend/agents/AgentProviderFailure";

afterEach(() => {
  vi.useRealTimers();
});

it.each([
  "provider_unreachable",
  "provider_unavailable",
  "provider_rate_limited",
  "provider_quota_exhausted",
])("accepts the plan retry code %s", (code) => {
  expect(isPlanRetryCode(code)).toBe(true);
});

it.each(["provider_auth_failed", "", null, 429])(
  "rejects %s as a plan retry code",
  (code) => {
    expect(isPlanRetryCode(code)).toBe(false);
  },
);

it("maps a Codex error name given as text", () => {
  const error = Object.assign(new Error("turn failed"), {
    data: { codexErrorInfo: "usageLimitExceeded", resetsAt: 1_900_000_000 },
  });

  expect(diagnosticProviderFailure(error)).toEqual({
    code: "provider_quota_exhausted",
    resetAt: new Date(1_900_000_000_000).toISOString(),
  });
});

it("maps the first known key of a structured Codex error", () => {
  const error = {
    data: { codexErrorInfo: { unknownFailure: {}, rateLimitExceeded: {} } },
  };

  expect(diagnosticProviderFailure(error)).toEqual({
    code: "provider_rate_limited",
    resetAt: null,
  });
});

it("falls back to the diagnostic text and its relative reset", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T10:00:00.000Z"));
  const error = Object.assign(new Error("HTTP 503, try again in 5 minutes"), {
    data: { codexErrorInfo: "somethingElse" },
  });

  expect(diagnosticProviderFailure(error)).toEqual({
    code: "provider_unavailable",
    resetAt: "2026-10-28T10:05:00.000Z",
  });
});

it("ignores failures that the retry policy does not understand", () => {
  expect(diagnosticProviderFailure(new Error("401 unauthorized"))).toBeNull();
  expect(diagnosticProviderFailure("plain text")).toBeNull();
});

it("reports a rejected Claude subscription window as exhausted", () => {
  expect(
    acpProviderFailure({
      "_claude/rateLimit": { status: "rejected", resetsAt: 1_900_000_000 },
    }),
  ).toEqual({
    code: "provider_quota_exhausted",
    resetAt: new Date(1_900_000_000_000).toISOString(),
  });
});

it("does not treat warnings or missing limit data as exhaustion", () => {
  expect(
    acpProviderFailure({ "_claude/rateLimit": { status: "allowed_warning" } }),
  ).toBeNull();
  expect(acpProviderFailure(undefined)).toBeNull();
});
