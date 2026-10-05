import { describe, expect, it } from "vitest";

import { formatTimezoneOffset } from "@/app/lib/timezone";

describe("formatTimezoneOffset", () => {
  it("returns the current GMT offset of a known zone", () => {
    expect(formatTimezoneOffset("Europe/Berlin")).toMatch(/^GMT\+0[12]:00$/u);
    expect(formatTimezoneOffset("America/New_York")).toMatch(/^GMT-0[45]:00$/u);
  });

  it("describes UTC without an offset", () => {
    expect(formatTimezoneOffset("UTC")).toMatch(/^GMT(\+00:00)?$/u);
  });

  it("falls back to the zone name for zones the runtime does not know", () => {
    expect(formatTimezoneOffset("Mars/Olympus")).toBe("Mars/Olympus");
  });
});
