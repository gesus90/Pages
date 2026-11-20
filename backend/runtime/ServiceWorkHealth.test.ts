import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { hasServiceProgress, recordServiceProgress } from "./ServiceWorkHealth";

const MAXIMUM_IDLE_MS = 120_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

it("reports no progress for a worker that never recorded work", () => {
  expect(hasServiceProgress(["never-recorded"])).toBe(false);
});

it("reports progress right after work was recorded", () => {
  recordServiceProgress("fresh-worker");

  expect(hasServiceProgress(["fresh-worker"])).toBe(true);
});

it("keeps reporting progress until just before the idle limit", () => {
  recordServiceProgress("boundary-worker");
  vi.advanceTimersByTime(MAXIMUM_IDLE_MS - 1);

  expect(hasServiceProgress(["boundary-worker"])).toBe(true);
});

it("reports no progress once the idle limit is reached", () => {
  recordServiceProgress("stale-worker");
  vi.advanceTimersByTime(MAXIMUM_IDLE_MS);

  expect(hasServiceProgress(["stale-worker"])).toBe(false);
});

it("requires every listed worker to have recent progress", () => {
  recordServiceProgress("pair-first");

  expect(hasServiceProgress(["pair-first", "pair-missing"])).toBe(false);

  recordServiceProgress("pair-missing");

  expect(hasServiceProgress(["pair-first", "pair-missing"])).toBe(true);
});

it("treats an empty worker list as healthy", () => {
  expect(hasServiceProgress([])).toBe(true);
});
