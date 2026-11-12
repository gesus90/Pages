import { expect, it } from "vitest";

import {
  formatClock,
  formatDuration,
  formatLocalTime,
} from "@/app/components/agents/plans/plan-agent-console/console-time";

it("formats valid local times and rejects missing or invalid times", () => {
  expect(formatLocalTime(null)).toBeNull();
  expect(formatLocalTime("invalid")).toBeNull();
  expect(formatLocalTime("2026-10-15T10:00:00Z")).toBe(
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date("2026-10-15T10:00:00Z")),
  );
});

it("formats durations at minute and hour boundaries and clamps negative values", () => {
  expect(formatDuration(-1000)).toBe("0 s");
  expect(formatDuration(59_600)).toBe("1 min 0 s");
  expect(formatDuration(3_661_000)).toBe("1 h 1 min");
  expect(formatClock(-1)).toBe("00:00");
  expect(formatClock(3_661_000)).toBe("1:01:01");
});
