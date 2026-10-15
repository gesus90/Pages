import { describe, expect, it } from "vitest";

import { classifyCliFailure } from "@/backend/agents/cli/CliResultParser";

describe("classifyCliFailure", () => {
  it.each([
    ["an HTTP 401 status", { error: { message: "HTTP 401 from upstream" } }],
    ["a missing login", { result: "Not logged in · Please run /login" }],
    ["an unauthorized reply", { message: "Unauthorised request" }],
    ["an authentication error type", { type: "authentication_error" }],
  ])("recognises %s as an authentication failure", (_, payload) => {
    expect(classifyCliFailure(payload)).toBe("cli_auth_failed");
  });

  it.each([
    ["a usage limit", { message: "You have hit your usage limit." }],
    ["an exhausted quota", { error: { code: "insufficient_quota" } }],
  ])("recognises %s as an exhausted quota", (_, payload) => {
    expect(classifyCliFailure(payload)).toBe("provider_quota_exhausted");
  });

  it.each([
    ["an HTTP 429 status", { status: "429 Too Many Requests" }],
    ["a rate limit type", { type: "rate_limit_error" }],
    ["a spaced rate limit text", { message: "rate limit exceeded" }],
  ])("recognises %s as rate limiting", (_, payload) => {
    expect(classifyCliFailure(payload)).toBe("provider_rate_limited");
  });

  it("prefers authentication over quota and quota over rate limits", () => {
    expect(classifyCliFailure({ message: "401 after the usage limit" })).toBe(
      "cli_auth_failed",
    );
    expect(
      classifyCliFailure({ message: "usage limit, rate limit, retry" }),
    ).toBe("provider_quota_exhausted");
  });

  it("does not match status numbers inside longer numbers", () => {
    expect(classifyCliFailure({ message: "request 14010 failed" })).toBe(
      "cli_check_failed",
    );
    expect(classifyCliFailure({ message: "port 4290 refused" })).toBe(
      "cli_check_failed",
    );
  });

  it.each([
    ["an unknown failure", { message: "boom" }],
    ["an empty object", {}],
    ["a string", "something went wrong"],
    ["null", null],
    ["undefined", undefined],
  ])("falls back to a generic check failure for %s", (_, payload) => {
    expect(classifyCliFailure(payload)).toBe("cli_check_failed");
  });
});
