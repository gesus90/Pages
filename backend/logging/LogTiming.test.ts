import { afterEach, expect, it, vi } from "vitest";

import { readSlowOperationThresholdMs } from "./LogTiming";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("uses the 250 ms default when the threshold variable is absent", () => {
  vi.stubEnv("PAGES_SLOW_QUERY_MS", undefined);

  expect(readSlowOperationThresholdMs()).toBe(250);
});

it.each(["", "   ", "soon", "-1", "Infinity", "NaN"])(
  "falls back to the default for the unusable value %j",
  (configured) => {
    vi.stubEnv("PAGES_SLOW_QUERY_MS", configured);

    expect(readSlowOperationThresholdMs()).toBe(250);
  },
);

it("accepts zero and fractional thresholds after trimming whitespace", () => {
  vi.stubEnv("PAGES_SLOW_QUERY_MS", "0");
  expect(readSlowOperationThresholdMs()).toBe(0);

  vi.stubEnv("PAGES_SLOW_QUERY_MS", "  12.5  ");
  expect(readSlowOperationThresholdMs()).toBe(12.5);
});
