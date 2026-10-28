import { expect, it } from "vitest";

import { formatTimezoneOffset } from "@/app/lib/timezone";

it("shows the current GMT offset of a known zone", () => {
  expect(formatTimezoneOffset("Etc/GMT-3")).toBe("GMT+03:00");
  expect(formatTimezoneOffset("Asia/Kolkata")).toBe("GMT+05:30");
});

it("returns the zone name itself when the runtime does not know the zone", () => {
  expect(formatTimezoneOffset("Mars/Olympus")).toBe("Mars/Olympus");
});
