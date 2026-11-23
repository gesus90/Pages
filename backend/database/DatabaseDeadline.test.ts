import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { withDeadline } from "@/backend/database/DatabaseDeadline";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("returns the work result before the deadline", async () => {
  await expect(
    withDeadline(Promise.resolve("done"), 50, () => "late"),
  ).resolves.toBe("done");
  expect(vi.getTimerCount()).toBe(0);
});

it("returns the timeout result after the deadline", async () => {
  const pending = withDeadline(
    new Promise<string>(() => undefined),
    50,
    () => "late",
  );
  await vi.advanceTimersByTimeAsync(50);
  await expect(pending).resolves.toBe("late");
});

it("rejects with the error the timeout callback throws", async () => {
  const pending = withDeadline(new Promise<string>(() => undefined), 5, () => {
    throw new Error("boom");
  });
  const outcome = expect(pending).rejects.toThrow("boom");
  await vi.advanceTimersByTimeAsync(5);
  await outcome;
});

it("wraps a thrown non-error", async () => {
  const pending = withDeadline(new Promise<string>(() => undefined), 5, () => {
    throw "text" as unknown;
  });
  const outcome = expect(pending).rejects.toThrow("text");
  await vi.advanceTimersByTimeAsync(5);
  await outcome;
});
