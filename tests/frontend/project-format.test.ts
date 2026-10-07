import { describe, expect, it } from "vitest";

import { formatCounter } from "@/app/lib/project-format";

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
