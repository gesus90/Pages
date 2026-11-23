import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliPausableDeadline } from "@/backend/agents/cli/CliPausableDeadline";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("expires after the full budget when it is never paused", () => {
  const expire = vi.fn();
  new CliPausableDeadline(1000, expire);
  vi.advanceTimersByTime(999);
  expect(expire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(expire).toHaveBeenCalledTimes(1);
});

it("keeps the remaining budget during a pause and ignores repeated calls", () => {
  const expire = vi.fn();
  const deadline = new CliPausableDeadline(1000, expire);
  vi.advanceTimersByTime(400);
  deadline.pause();
  deadline.pause();
  vi.advanceTimersByTime(10_000);
  expect(expire).not.toHaveBeenCalled();
  deadline.resume();
  deadline.resume();
  vi.advanceTimersByTime(599);
  expect(expire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(expire).toHaveBeenCalledTimes(1);
});

it("keeps at least one millisecond when the budget is used up while pausing", () => {
  const expire = vi.fn();
  const deadline = new CliPausableDeadline(100, expire);
  vi.setSystemTime(Date.now() + 500);
  deadline.pause();
  deadline.resume();
  vi.advanceTimersByTime(1);
  expect(expire).toHaveBeenCalledTimes(1);
});

it("releases the timer for good on close", () => {
  const expire = vi.fn();
  const deadline = new CliPausableDeadline(1000, expire);
  deadline.close();
  deadline.resume();
  vi.advanceTimersByTime(5000);
  expect(expire).not.toHaveBeenCalled();
});
