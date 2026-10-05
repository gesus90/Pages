import { describe, expect, it } from "vitest";

import { formatCounter, formatDate } from "@/app/lib/project-format";

describe("formatCounter", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1.000"],
    [1234, "1.234"],
    [5000, "5.000"],
    [1005, "1.005"],
  ])("formats %d as %s", (value, expected) => {
    expect(formatCounter(value)).toBe(expected);
  });
});

describe("formatDate", () => {
  it.each([
    [null, "---"],
    ["", "---"],
    ["2026-09-30", "30.9.2026"],
    ["2026-12-15T12:00:00", "15.12.2026"],
    ["not-a-date", "not-a-date"],
  ])("formats %j as %j", (value, expected) => {
    expect(formatDate(value)).toBe(expected);
  });
});
