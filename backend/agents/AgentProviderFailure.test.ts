import { describe, expect, it } from "vitest";

import {
  acpProviderFailure,
  diagnosticProviderFailure,
  isPlanRetryCode,
} from "@/backend/agents/AgentProviderFailure";

describe("isPlanRetryCode", () => {
  it.each([
    "provider_unreachable",
    "provider_unavailable",
    "provider_rate_limited",
    "openrouter_rate_limited",
    "provider_quota_exhausted",
  ])("accepts %s", (code) => {
    expect(isPlanRetryCode(code)).toBe(true);
  });

  it("rejects other codes", () => {
    expect(isPlanRetryCode("plan_invalid")).toBe(false);
    expect(isPlanRetryCode(null)).toBe(false);
  });
});

describe("diagnosticProviderFailure", () => {
  it("classifies a codex failure given as text", () => {
    expect(
      diagnosticProviderFailure({
        data: { codexErrorInfo: "serverOverloaded" },
      }),
    ).toEqual({ code: "provider_unavailable", resetAt: null });
  });

  it("classifies a codex failure given as object keys", () => {
    expect(
      diagnosticProviderFailure({
        data: {
          codexErrorInfo: { usageLimitExceeded: {} },
          resetsAt: "2026-01-01T00:00:00Z",
        },
      }),
    ).toEqual({
      code: "provider_quota_exhausted",
      resetAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("falls back to the message and finds a reset in its text", () => {
    const error = new Error(
      "429 rate limit, try again at 2026-01-01T00:00:00Z",
    );
    const result = diagnosticProviderFailure(
      Object.assign(error, { data: { codexErrorInfo: "unknownInfo" } }),
    );

    expect(result).toEqual({
      code: "provider_rate_limited",
      resetAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("ignores codex info without a retry meaning and plain values", () => {
    expect(diagnosticProviderFailure("plain")).toBeNull();
    expect(
      diagnosticProviderFailure({ data: { codexErrorInfo: "other" } }),
    ).toBeNull();
    expect(diagnosticProviderFailure(null)).toBeNull();
  });
});

describe("acpProviderFailure", () => {
  it("reads a rejected Claude window", () => {
    expect(
      acpProviderFailure({
        "_claude/rateLimit": { status: "rejected", resetsAt: 1_900_000_000 },
      }),
    ).toEqual({
      code: "provider_quota_exhausted",
      resetAt: "2030-03-17T17:46:40.000Z",
    });
  });

  it("ignores warnings and missing data", () => {
    expect(
      acpProviderFailure({
        "_claude/rateLimit": { status: "allowed_warning" },
      }),
    ).toBeNull();
    expect(acpProviderFailure(undefined)).toBeNull();
  });
});
