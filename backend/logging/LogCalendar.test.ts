import { afterEach, expect, it, vi } from "vitest";

import { dailyLogDate, logDate, oldestLogDate } from "./LogCalendar";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("uses the server time zone that is active when the module loads", async () => {
  vi.stubEnv("TZ", "Europe/Berlin");
  vi.resetModules();

  const calendar = await import("./LogCalendar");

  expect(calendar.LOG_TIME_ZONE).toBe("Europe/Berlin");
});

it("formats the server-local calendar date with zero padding", () => {
  expect(logDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  expect(logDate(new Date(2026, 10, 20, 0, 0))).toBe("2026-11-20");
});

it("keeps a single-day window on the current date", () => {
  expect(oldestLogDate(new Date(2026, 10, 20, 9, 0), 1)).toBe("2026-11-20");
});

it("counts the requested number of calendar days, including the current one", () => {
  expect(oldestLogDate(new Date(2026, 10, 20, 9, 0), 30)).toBe("2026-10-22");
  expect(oldestLogDate(new Date(2027, 0, 2, 9, 0), 3)).toBe("2026-12-31");
});

it("does not lose a day across the spring daylight-saving change", () => {
  vi.stubEnv("TZ", "Europe/Berlin");

  expect(oldestLogDate(new Date(2026, 3, 1, 0, 30), 3)).toBe("2026-03-30");
});

it("recognizes only canonical daily filenames of real calendar dates", () => {
  expect(dailyLogDate("pages-2026-01-05.jsonl")).toBe("2026-01-05");
  expect(dailyLogDate("pages-2024-02-29.jsonl")).toBe("2024-02-29");
  expect(dailyLogDate("pages-2026-02-30.jsonl")).toBeNull();
  expect(dailyLogDate("pages-2026-13-01.jsonl")).toBeNull();
  expect(dailyLogDate("pages-2026-01-05.log")).toBeNull();
  expect(dailyLogDate("notes.jsonl")).toBeNull();
});
