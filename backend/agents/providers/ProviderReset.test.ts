import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  diagnosticProviderReset,
  httpProviderReset,
  providerResetTimestamp,
  structuredProviderReset,
} from "@/backend/agents/providers/ProviderReset";

const NOW = Date.parse("2026-10-28T00:00:00.000Z");

// Absolute provider windows and relative retry durations must share one clock.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

function responseWith(headers: Record<string, string>): Response {
  return new Response(null, { status: 429, headers });
}

it("normalizes epoch seconds and milliseconds as numbers or strings", () => {
  expect(providerResetTimestamp(1_800_000_000)).toBe(
    "2027-01-15T08:00:00.000Z",
  );
  expect(providerResetTimestamp(1_800_000_000_000)).toBe(
    "2027-01-15T08:00:00.000Z",
  );
  expect(providerResetTimestamp("1800000000.5")).toBe(
    "2027-01-15T08:00:00.500Z",
  );
  expect(providerResetTimestamp("1800000000000")).toBe(
    "2027-01-15T08:00:00.000Z",
  );
});

it("accepts only timestamps with an explicit timezone", () => {
  expect(providerResetTimestamp("2026-10-28T10:00:00+02:00")).toBe(
    "2026-10-28T08:00:00.000Z",
  );
  expect(providerResetTimestamp("Wed, 28 Oct 2026 08:00:00 GMT")).toBe(
    "2026-10-28T08:00:00.000Z",
  );
  expect(providerResetTimestamp("2026-10-28T10:00:00")).toBeNull();
  expect(providerResetTimestamp("not a dateZ")).toBeNull();
});

it("refuses non-positive, infinite, out-of-range and non-scalar input", () => {
  expect(providerResetTimestamp(0)).toBeNull();
  expect(providerResetTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
  expect(providerResetTimestamp(9e15)).toBeNull();
  expect(providerResetTimestamp({ at: 1 })).toBeNull();
});

it("returns the latest explicit structured reset field", () => {
  expect(
    structuredProviderReset({
      resetAt: 1_800_000_000,
      error: { reset_at: "2027-02-01T00:00:00Z", resetsAt: "soon" },
    }),
  ).toBe("2027-02-01T00:00:00.000Z");
  expect(structuredProviderReset({ message: "2027-02-01T00:00:00Z" })).toBe(
    null,
  );
});

it("extracts an ISO reset instant from diagnostic text", () => {
  expect(
    diagnosticProviderReset("Limit hit, resets at 2026-10-28T05:00:00Z.", NOW),
  ).toBe("2026-10-28T05:00:00.000Z");
});

it("extracts a reset duration from diagnostic text", () => {
  expect(diagnosticProviderReset("try again in 1h 30m 5s", NOW)).toBe(
    "2026-10-28T01:30:05.000Z",
  );
  expect(diagnosticProviderReset("retry after 250ms", NOW)).toBe(
    "2026-10-28T00:00:00.250Z",
  );
  expect(diagnosticProviderReset("Retry after 2 milliseconds", NOW)).toBe(
    "2026-10-28T00:00:00.002Z",
  );
  expect(diagnosticProviderReset("quota exceeded", NOW)).toBeNull();
});

it("uses the current clock when no time is passed", () => {
  const reset = diagnosticProviderReset("resets in 1 minute");
  expect(reset).not.toBeNull();
  expect(Date.parse(reset ?? "")).toBeGreaterThan(Date.now());
});

it("prefers the latest of retry-after, structured fields and window headers", () => {
  const reset = httpProviderReset(
    responseWith({
      "retry-after": "2026-10-28T00:00:00Z",
      "x-ratelimit-reset-tokens": "2026-10-29T00:00:00Z",
      "x-ratelimit-reset-requests": "6m0s",
    }),
    { resetAt: "2026-10-28T12:00:00Z" },
    "provider_rate_limited",
  );
  expect(reset).toBe("2026-10-29T00:00:00.000Z");
});

it("reads retry-after seconds and window durations relative to now", () => {
  const before = Date.now();
  const reset = httpProviderReset(
    responseWith({
      "retry-after": "30",
      "x-ratelimit-reset": "1s junk",
      "x-ratelimit-reset-requests": "junk 5s",
      "anthropic-ratelimit-requests-reset": "soon",
      "anthropic-ratelimit-tokens-reset": `${"9".repeat(400)}s`,
    }),
    null,
    "provider_rate_limited",
  );
  const instant = Date.parse(reset ?? "");
  expect(instant).toBeGreaterThanOrEqual(before + 29_000);
  expect(instant).toBeLessThanOrEqual(Date.now() + 31_000);
});

it("ignores window headers for an exhausted billing quota", () => {
  expect(
    httpProviderReset(
      responseWith({
        "anthropic-ratelimit-tokens-reset": "2026-11-01T00:00:00Z",
      }),
      {},
      "provider_quota_exhausted",
    ),
  ).toBeNull();
  expect(
    httpProviderReset(responseWith({}), {}, "provider_rate_limited"),
  ).toBeNull();
});
