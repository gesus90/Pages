import { describe, expect, it } from "vitest";

import { normalizeEventTime, validateEvent } from "./ProjectEventValues";

describe("normalizeEventTime", () => {
  it("turns blank or missing times into null and trims others", () => {
    expect(normalizeEventTime(null)).toBeNull();
    expect(normalizeEventTime("   ")).toBeNull();
    expect(normalizeEventTime(" 10:30 ")).toBe("10:30");
  });
});

describe("validateEvent", () => {
  it("returns the trimmed title of a valid event", () => {
    expect(validateEvent({ title: " Kickoff ", eventDate: "2026-01-02" })).toBe(
      "Kickoff",
    );
  });

  it("rejects empty and overlong titles", () => {
    expect(() =>
      validateEvent({ title: " ", eventDate: "2026-01-02" }),
    ).toThrow("Event title");
    expect(() =>
      validateEvent({ title: "a".repeat(201), eventDate: "2026-01-02" }),
    ).toThrow("Event title");
  });

  it("rejects malformed dates", () => {
    expect(() =>
      validateEvent({ title: "A", eventDate: "02.01.2026" }),
    ).toThrow("YYYY-MM-DD");
  });
});
